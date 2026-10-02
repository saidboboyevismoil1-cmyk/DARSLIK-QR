import UIKit
import WebKit
import AVFoundation
import UserNotifications

/// Veb ↔ native ko'prik (docs/lock-mode/native-bridge.md). Android `NativeBridge.java` bilan bir xil protokol.
/// Har chaqiruv aynan bitta javob qaytaradi: window.__efNative.resolve(id, json).
final class NativeBridge {
    private weak var vc: ViewController?
    private weak var webView: WKWebView?
    private var provider: ProtectionProvider = L0Provider()
    private var deadline: Date?          // o'lik odam taymeri (monotonik)
    private var lessonEnd: Date?
    private var offlineReleaseSec = 900
    private var timer: Timer?
    private var preJoin = false
    // Monotonik soat: telefon soati o'zgarsa ta'sir qilmaydi
    private func now() -> TimeInterval { ProcessInfo.processInfo.systemUptime }
    private var deadlineAt: TimeInterval?
    private var lessonEndAt: TimeInterval?

    init(vc: ViewController, webView: WKWebView) {
        self.vc = vc; self.webView = webView
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.emit("protectionChanged") }
        NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.emit("protectionChanged") }
    }

    // MARK: javob/hodisa
    private func js(_ s: String) { DispatchQueue.main.async { self.webView?.evaluateJavaScript(s, completionHandler: nil) } }
    private func quote(_ s: String) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: [s], options: []), let t = String(data: d, encoding: .utf8) else { return "\"\"" }
        return String(t.dropFirst().dropLast())
    }
    private func json(_ o: Any) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: o, options: [.fragmentsAllowed]), let t = String(data: d, encoding: .utf8) else { return "null" }
        return t
    }
    private func reply(_ id: Int, _ data: Any?) { js("window.__efNative&&window.__efNative.resolve(\(id),\(quote(json(["ok": true, "data": data ?? NSNull()]))))") }
    private func fail(_ id: Int, _ err: String) { js("window.__efNative&&window.__efNative.resolve(\(id),\(quote(json(["ok": false, "error": err]))))") }
    func emit(_ evt: String, _ data: [String: Any] = [:]) { js("window.__efNative&&window.__efNative.emit(\(quote(evt)),\(quote(json(data))))") }

    // MARK: dispatch
    func handle(_ body: [String: Any]) {
        guard let id = body["id"] as? Int, let method = body["method"] as? String else { return }
        var args = [String: Any]()
        if let s = body["args"] as? String, let d = s.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] { args = o }
        else if let o = body["args"] as? [String: Any] { args = o }
        DispatchQueue.main.async { self.dispatch(id, method, args) }
    }

    private func dispatch(_ id: Int, _ method: String, _ a: [String: Any]) {
        switch method {
        case "info": reply(id, info())
        case "permissions": permissions { self.reply(id, $0) }
        case "requestPermission": requestPermission(a["id"] as? String ?? "") { self.reply(id, $0) }
        case "openSettings": openSettings(); reply(id, ["ok": true])
        case "deviceKey": reply(id, ["key": DeviceKey.get()])
        case "attest": AppAttest.attest(nonce: a["nonce"] as? String ?? "") { r in DispatchQueue.main.async { self.reply(id, r) } }
        case "protection.dryRun": dryRun(id, a)
        case "protection.start": start(id, a)
        case "protection.update": applyTimers(a); reply(id, ["ok": true])
        case "protection.state": reply(id, state())
        case "protection.stop": stopProtection(); reply(id, ["ok": true])
        case "serverContact":
            if let r = a["remainingSeconds"] as? Double, r > 0 { deadlineAt = now() + r } else { deadlineAt = now() + Double(offlineReleaseSec) }
            reply(id, ["ok": true])
        case "sos": sos(id, a["number"] as? String ?? "")
        case "scanQR": scan(id)
        case "openExternal":
            if let s = a["url"] as? String, let u = URL(string: s), ["http", "https"].contains(u.scheme ?? "") { UIApplication.shared.open(u); reply(id, ["ok": true]) }
            else { reply(id, ["ok": false]) }
        case "setBackHandled", "openCalculator", "exitApp": reply(id, ["ok": false])   // iOS'da yo'q
        case "setSystemBarsDark": vc?.setDark((a["dark"] as? Bool) ?? false); reply(id, ["ok": true])
        case "setPullToRefresh": vc?.setPullToRefresh((a["value"] as? Bool) ?? false); reply(id, ["ok": true])
        default: fail(id, "unsupported")
        }
    }

    // MARK: info
    private func info() -> [String: Any] {
        var cand = [String](), req = [String: [String]]()
        if Flags.l1 { cand.append("ios-l1"); req["ios-l1"] = [] }
        if Flags.l2 { cand.append("ios-l2"); req["ios-l2"] = ["screentime"] }
        cand.append("ios-l0"); req["ios-l0"] = []
        let dev = UIDevice.current
        return ["platform": "ios", "flavor": "", "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
                "osVersion": dev.systemVersion, "brand": "Apple", "model": dev.model, "candidates": cand, "requires": req,
                "features": ["iosL1": Flags.l1, "iosL2": Flags.l2, "nativeScan": true]]
    }

    private func makeProvider(_ level: String) -> ProtectionProvider {
        #if canImport(AutomaticAssessmentConfiguration)
        if level == "ios-l1" && Flags.l1 { return L1Provider() }
        #endif
        #if canImport(FamilyControls)
        if #available(iOS 16.0, *), level == "ios-l2" && Flags.l2 { return L2Provider() }
        #endif
        return L0Provider()
    }

    // MARK: ruxsatlar
    private func permissions(_ done: @escaping ([[String: Any]]) -> Void) {
        let cam: String
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: cam = "granted"
        case .notDetermined: cam = "unknown"
        default: cam = "denied"
        }
        var list: [[String: Any]] = [["id": "camera", "status": cam, "canRequest": cam == "unknown", "guide": false]]
        #if canImport(FamilyControls)
        if #available(iOS 16.0, *), Flags.l2 { list.append(["id": "screentime", "status": L2Provider.authorized ? "granted" : "denied", "canRequest": !L2Provider.authorized, "guide": false]) }
        #endif
        UNUserNotificationCenter.current().getNotificationSettings { s in
            let st: String
            switch s.authorizationStatus {
            case .authorized, .provisional, .ephemeral: st = "granted"
            case .notDetermined: st = "unknown"
            default: st = "denied"
            }
            var out = list
            out.append(["id": "notifications", "status": st, "canRequest": st == "unknown", "guide": false])
            DispatchQueue.main.async { done(out) }
        }
    }

    private func requestPermission(_ perm: String, _ done: @escaping ([String: Any]) -> Void) {
        switch perm {
        case "camera":
            AVCaptureDevice.requestAccess(for: .video) { ok in DispatchQueue.main.async { done(["status": ok ? "granted" : "denied"]) } }
        case "notifications":
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in DispatchQueue.main.async { done(["status": ok ? "granted" : "denied"]) } }
        case "screentime":
            #if canImport(FamilyControls)
            if #available(iOS 16.0, *) { L2Provider.requestAuthorization { ok in DispatchQueue.main.async { done(["status": ok ? "granted" : "denied"]); self.emit("permissionChanged", ["id": "screentime"]) } } } else { done(["status": "na"]) }
            #else
            done(["status": "na"])
            #endif
        default: openSettings(); done(["status": "unknown"])
        }
    }

    private func openSettings() { if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) } }

    // MARK: himoya
    private func dryRun(_ id: Int, _ a: [String: Any]) {
        let want = a["level"] as? String ?? "ios-l0"
        let p = makeProvider(want)
        if p.level != want { reply(id, ["ok": false, "reason": "permission"]); return }   // bayroq o'chiq — daraja mavjud emas
        p.dryRun { ok, reason in DispatchQueue.main.async { self.reply(id, ["ok": ok, "reason": reason as Any]) } }
    }

    private func start(_ id: Int, _ a: [String: Any]) {
        stopProtection()
        let level = a["level"] as? String ?? "ios-l0"
        let p = makeProvider(level)
        if p.level != level { reply(id, ["ok": false, "level": p.level, "reason": "permission"]); return }
        applyTimers(a)
        preJoin = (a["preJoin"] as? Bool) ?? false
        p.onChange = { [weak self] in self?.emit("protectionChanged") }
        p.start(endsInSec: (a["endsInSec"] as? Int) ?? 0) { ok, reason in
            DispatchQueue.main.async {
                if ok { self.provider = p; self.startTicker() } else { self.deadlineAt = nil; self.lessonEndAt = nil }
                self.reply(id, ["ok": ok, "level": p.level, "reason": reason as Any])
            }
        }
    }

    private func applyTimers(_ a: [String: Any]) {
        if let s = a["offlineReleaseSec"] as? Int, s > 0 { offlineReleaseSec = s; deadlineAt = now() + Double(s) }
        if let e = a["endsInSec"] as? Int { lessonEndAt = e > 0 ? now() + Double(e) : nil }
    }

    private func stopProtection() {
        provider.stop(); provider = L0Provider()
        timer?.invalidate(); timer = nil
        deadlineAt = nil; lessonEndAt = nil
        UIApplication.shared.isIdleTimerDisabled = true
    }

    private func startTicker() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer!, forMode: .common)
    }

    private func tick() {
        let t = now()
        if let d = deadlineAt, t >= d { release("offline"); return }
        if let e = lessonEndAt, t >= e { release("timer") }
    }

    private func release(_ reason: String) {
        stopProtection()
        emit("autoRelease", ["reason": reason])
        emit("protectionChanged")
    }

    private func state() -> [String: Any] {
        var s = provider.state()
        if s["checks"] == nil { s["checks"] = [String: Any]() }
        return s
    }

    /// SOS: himoya hech qachon bloklamaydi — vaqtincha olinadi, qo'ng'iroqdan keyin qayta yoqiladi.
    private func sos(_ id: Int, _ number: String) {
        let level = provider.level
        let digits = number.filter { "+0123456789".contains($0) }
        let resume = level != "ios-l0"
        let remaining = lessonEndAt.map { max(0, Int($0 - now())) } ?? 0
        provider.stop()
        if let u = URL(string: "tel://\(digits)"), !digits.isEmpty { UIApplication.shared.open(u) }
        reply(id, ["ok": true])
        if resume {
            var obs: NSObjectProtocol?
            obs = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                if let o = obs { NotificationCenter.default.removeObserver(o) }
                guard let self = self else { return }
                self.provider.start(endsInSec: remaining) { _, _ in self.emit("protectionChanged") }
            }
        }
    }

    private func scan(_ id: Int) {
        guard let vc = vc else { reply(id, ["error": "no_camera"]); return }
        let s = QRScannerViewController()
        s.modalPresentationStyle = .fullScreen
        s.completion = { [weak self] r in self?.reply(id, r) }
        vc.present(s, animated: true)
    }
}
