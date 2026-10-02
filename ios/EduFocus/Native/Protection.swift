import UIKit
#if canImport(AutomaticAssessmentConfiguration)
import AutomaticAssessmentConfiguration
#endif
#if canImport(FamilyControls)
import FamilyControls
import ManagedSettings
import DeviceActivity
#endif

/// Himoya provayderi. Daraja nomlari serverdagi bilan bir xil: ios-l0 / ios-l1 / ios-l2.
protocol ProtectionProvider: AnyObject {
    var level: String { get }
    var onChange: (() -> Void)? { get set }
    /// Qisqa sinov: yoqadi, tekshiradi, o'chiradi.
    func dryRun(_ done: @escaping (Bool, String?) -> Void)
    func start(endsInSec: Int, _ done: @escaping (Bool, String?) -> Void)
    func stop()
    /// {active, reasons[], checks{}, level}
    func state() -> [String: Any]
}

// MARK: - L0: himoyasiz (kuzatuv yo'q, faqat ekran o'chmasin)
final class L0Provider: ProtectionProvider {
    let level = "ios-l0"
    var onChange: (() -> Void)?
    func dryRun(_ done: @escaping (Bool, String?) -> Void) { done(true, nil) }
    func start(endsInSec: Int, _ done: @escaping (Bool, String?) -> Void) { done(true, nil) }
    func stop() {}
    func state() -> [String: Any] { ["active": false, "reasons": [String](), "checks": [String: Any](), "level": level] }
}

// MARK: - L1: Automatic Assessment Configuration (entitlement kerak)
#if canImport(AutomaticAssessmentConfiguration)
final class L1Provider: NSObject, ProtectionProvider, AEAssessmentSessionDelegate {
    let level = "ios-l1"
    var onChange: (() -> Void)?
    private var session: AEAssessmentSession?
    private var began = false
    private var beginDone: ((Bool, String?) -> Void)?

    func dryRun(_ done: @escaping (Bool, String?) -> Void) {
        start(endsInSec: 0) { [weak self] ok, reason in
            guard ok else { done(false, reason); return }
            self?.stop(); done(true, nil)
        }
    }

    func start(endsInSec: Int, _ done: @escaping (Bool, String?) -> Void) {
        guard Flags.l1 else { done(false, "permission"); return }
        let cfg = AEAssessmentConfiguration()
        cfg.allowsAccessibilitySpeech = true   // maxsus imkoniyatlar to'sib qo'yilmaydi
        let s = AEAssessmentSession(configuration: cfg)
        s.delegate = self
        session = s
        beginDone = done
        s.begin()
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self = self, let cb = self.beginDone else { return }
            self.beginDone = nil; cb(false, "timeout")
        }
    }

    func stop() {
        session?.end(); session = nil; began = false
        onChange?()
    }

    func state() -> [String: Any] {
        ["active": began, "reasons": began ? [String]() : ["no_assessment"],
         "checks": ["assessment": began, "foreground": UIApplication.shared.applicationState == .active], "level": level]
    }

    func assessmentSessionDidBegin(_ session: AEAssessmentSession) {
        began = true
        beginDone?(true, nil); beginDone = nil
        onChange?()
    }
    func assessmentSession(_ session: AEAssessmentSession, failedToBeginWithError error: Error) {
        began = false
        beginDone?(false, "permission"); beginDone = nil
    }
    func assessmentSession(_ session: AEAssessmentSession, wasInterruptedWithError error: Error) { began = false; onChange?() }
    func assessmentSessionDidEnd(_ session: AEAssessmentSession) { began = false; onChange?() }
}
#endif

// MARK: - L2: Screen Time (FamilyControls + ManagedSettings, entitlement kerak)
#if canImport(FamilyControls)
@available(iOS 16.0, *)
final class L2Provider: ProtectionProvider {
    let level = "ios-l2"
    var onChange: (() -> Void)?
    private let store = ManagedSettingsStore()
    private let center = DeviceActivityCenter()
    private let activity = DeviceActivityName("edufocus.lesson")
    private var on = false

    static var authorized: Bool { AuthorizationCenter.shared.authorizationStatus == .approved }

    static func requestAuthorization(_ done: @escaping (Bool) -> Void) {
        guard Flags.l2 else { done(false); return }
        Task { @MainActor in
            do { try await AuthorizationCenter.shared.requestAuthorization(for: .individual); done(authorized) }
            catch { done(false) }
        }
    }

    func dryRun(_ done: @escaping (Bool, String?) -> Void) {
        start(endsInSec: 0) { [weak self] ok, reason in
            guard ok else { done(false, reason); return }
            self?.stop(); done(true, nil)
        }
    }

    func start(endsInSec: Int, _ done: @escaping (Bool, String?) -> Void) {
        guard Flags.l2 else { done(false, "permission"); return }
        guard Self.authorized else { done(false, "permission"); return }
        store.shield.applicationCategories = .all()
        store.shield.webDomainCategories = .all()
        on = true
        // Ilova o'ldirilsa ham ekstension qalqonni vaqtida olib tashlaydi (DeviceActivity intervali kamida 15 daqiqa)
        if endsInSec > 0 {
            let cal = Calendar.current
            let now = Date()
            let end = now.addingTimeInterval(TimeInterval(max(endsInSec, 15 * 60)))
            let sched = DeviceActivitySchedule(
                intervalStart: cal.dateComponents([.hour, .minute, .second], from: now),
                intervalEnd: cal.dateComponents([.hour, .minute, .second], from: end), repeats: false)
            try? center.startMonitoring(activity, during: sched)
        }
        onChange?()
        done(true, nil)
    }

    func stop() {
        store.clearAllSettings()
        center.stopMonitoring([activity])
        on = false
        onChange?()
    }

    func state() -> [String: Any] {
        let auth = Self.authorized
        var reasons = [String]()
        if !auth { reasons.append("no_authorization") }
        else if !on { reasons.append("no_shield") }
        return ["active": auth && on, "reasons": reasons,
                "checks": ["authorized": auth, "shield": on, "foreground": UIApplication.shared.applicationState == .active], "level": level]
    }
}
#endif
