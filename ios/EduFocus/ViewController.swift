import UIKit
import WebKit

/// EduFocus talaba ilovasi — WKWebView o'rami.
/// Server manzili: ../config/app-config.json (bundle ichiga app-config.json sifatida kiradi).
final class ViewController: UIViewController, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {

    // MARK: - Konfiguratsiya
    private struct AppConfig: Decodable {
        let productionUrl: String
        let developmentUrl: String
        let startPath: String
    }

    private lazy var config: AppConfig = {
        if let url = Bundle.main.url(forResource: "app-config", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let cfg = try? JSONDecoder().decode(AppConfig.self, from: data) {
            return cfg
        }
        return AppConfig(productionUrl: "https://edufocus.agrosmart24.uz", developmentUrl: "http://localhost:3000", startPath: "/student.html")
    }()

    private var baseURLString: String {
        if let override = ProcessInfo.processInfo.environment["EDUFOCUS_URL"], !override.isEmpty { return override }
        #if targetEnvironment(simulator)
        return config.developmentUrl
        #else
        return config.productionUrl
        #endif
    }
    private var startURL: URL { URL(string: baseURLString + config.startPath)! }
    private var serverHost: String? { URL(string: baseURLString)?.host }

    // MARK: - Holat
    private var webView: WKWebView!
    private let refreshControl = UIRefreshControl()
    private var splashView: UIView?
    private var isShowingOffline = false
    private var kioskActive = false
    private var bridge: NativeBridge!
    private let launchBackground = UIColor(named: "LaunchBackground") ?? .systemBackground

    override var preferredStatusBarStyle: UIStatusBarStyle { .default }
    override var prefersHomeIndicatorAutoHidden: Bool { kioskActive }

    // MARK: - Hayot sikli
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = launchBackground
        setupWebView()
        setupSplash()
        UIApplication.shared.isIdleTimerDisabled = true   // dars vaqtida ekran o'chmasin
        load()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        webView.frame = view.bounds
    }

    // MARK: - WebView
    private func setupWebView() {
        let controller = WKUserContentController()
        controller.add(self, name: "nativeBridge")

        // Web tomoni window.__efNativeHost.invoke(id, method, argsJson) orqali chaqiradi (docs/lock-mode/native-bridge.md).
        // window.AndroidBridge.retry — offline.html (Android bilan umumiy) uchun.
        let bridgeJS = """
        (function () {
          function post(m) { window.webkit.messageHandlers.nativeBridge.postMessage(m); }
          window.__efNativeHost = { platform: 'ios', invoke: function (id, method, args) { post({ id: id, method: method, args: args }); } };
          window.AndroidBridge = { retry: function () { post({ action: 'retry' }); }, getServerUrl: function () { return location.origin; } };
        })();
        """
        controller.addUserScript(WKUserScript(source: bridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let cfg = WKWebViewConfiguration()
        cfg.userContentController = controller
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.applicationNameForUserAgent = "EduFocusApp/5.0"
        cfg.websiteDataStore = .default()   // localStorage va service worker keshi saqlanadi

        webView = WKWebView(frame: view.bounds, configuration: cfg)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never   // safe-area'ni CSS env() boshqaradi
        webView.scrollView.bounces = true
        webView.scrollView.alwaysBounceVertical = true
        webView.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { webView.isInspectable = true }

        refreshControl.addTarget(self, action: #selector(pullRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl
        refreshControl.alpha = 0   // web ruxsat bergunga qadar o'chiq
        setPullToRefresh(false)

        view.addSubview(webView)
        bridge = NativeBridge(vc: self, webView: webView)
    }

    private func load() {
        isShowingOffline = false
        webView.load(URLRequest(url: startURL, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 20))
    }

    @objc private func pullRefresh() {
        isShowingOffline = false
        webView.reload()
    }

    /// Pull-to-refresh faqat xavfsiz ekranlarda (bosh sahifa, profil) yoqiladi — dars vaqtida emas.
    func setPullToRefresh(_ enabled: Bool) {
        refreshControl.isEnabled = enabled
        webView.scrollView.bounces = enabled
        if !enabled { refreshControl.endRefreshing() }
    }

    // MARK: - Splash
    private func setupSplash() {
        let splash = UIView(frame: view.bounds)
        splash.backgroundColor = launchBackground
        splash.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let logo = UIImageView(image: UIImage(named: "LaunchLogo"))
        logo.center = CGPoint(x: splash.bounds.midX, y: splash.bounds.midY)
        logo.autoresizingMask = [.flexibleTopMargin, .flexibleBottomMargin, .flexibleLeftMargin, .flexibleRightMargin]
        splash.addSubview(logo)
        view.addSubview(splash)
        splashView = splash
        // Sahifa yuklanmasa ham 5 soniyadan keyin yopiladi
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.hideSplash() }
    }

    private func hideSplash() {
        guard let splash = splashView else { return }
        splashView = nil
        UIView.animate(withDuration: 0.3, animations: { splash.alpha = 0 }, completion: { _ in splash.removeFromSuperview() })
    }

    // MARK: - Navigatsiya
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let scheme = url.scheme ?? ""
        if scheme == "about" || scheme == "blob" || scheme == "data" { decisionHandler(.allow); return }
        if (scheme == "http" || scheme == "https") && url.host == serverHost && navigationAction.targetFrame != nil {
            decisionHandler(.allow); return
        }
        // Tashqi havola (masalan, ustoz ruxsat bergan dars manbasi) — Safari'da ochiladi
        if scheme == "http" || scheme == "https" {
            decisionHandler(.cancel)
            UIApplication.shared.open(url)
            return
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshControl.endRefreshing()
        #if DEBUG
        NSLog("EF didFinish %@", webView.url?.absoluteString ?? "-")
        runSelfTestIfRequested()
        #endif
        if !isShowingOffline { hideSplash() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { handleLoadError(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { handleLoadError(error) }

    private func handleLoadError(_ error: Error) {
        #if DEBUG
        NSLog("EF load error: \(error)")
        #endif
        let code = (error as NSError).code
        if code == NSURLErrorCancelled { return }
        refreshControl.endRefreshing()
        showOffline()
    }

    /// Internet yo'q / server javob bermasa — chiroyli xato sahifasi (Android bilan bir xil offline.html).
    private func showOffline() {
        isShowingOffline = true
        hideSplash()
        if let url = Bundle.main.url(forResource: "offline", withExtension: "html"),
           let html = try? String(contentsOf: url, encoding: .utf8) {
            webView.loadHTMLString(html, baseURL: nil)
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { load() }   // xotira tugab, jarayon o'lsa — qayta yuklaymiz

    // MARK: - Kamera ruxsati (faqat o'z serverimiz uchun)
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let trusted = origin.host == serverHost
        decisionHandler(trusted && type == .camera ? .grant : .deny)
    }

    // MARK: - JS dialoglari
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "EduFocus", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "EduFocus", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Yo'q", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Ha", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    // MARK: - Web → native xabarlar
    func setDark(_ dark: Bool) { view.window?.overrideUserInterfaceStyle = dark ? .dark : .light }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeBridge", let body = message.body as? [String: Any] else { return }
        // Faqat o'z serverimiz yoki offline sahifadan keladigan xabarlar qabul qilinadi
        if let host = message.frameInfo.request.url?.host, host != serverHost { return }
        if body["method"] != nil { bridge.handle(body); return }
        if (body["action"] as? String) == "retry" { load() }
    }

    #if DEBUG
    /// Simulyator testi: EF_SELFTEST=<fayl yo'li> berilsa, ko'prik metodlarini chaqirib natijani faylga yozadi.
    private var selfTestDone = false
    private func runSelfTestIfRequested() {
        guard !selfTestDone, let out = ProcessInfo.processInfo.environment["EF_SELFTEST"], !out.isEmpty else { return }
        selfTestDone = true
        let script = """
        return await (async function () {
          const call = (m, a) => new Promise((res, rej) => {
            const id = Math.floor(Math.random() * 1e9);
            const prev = window.__efNative.resolve;
            window.__efNative.resolve = function (i, j) { if (i === id) { window.__efNative.resolve = prev; const r = JSON.parse(j); r.ok ? res(r.data) : rej(r.error); } else prev(i, j); };
            window.__efNativeHost.invoke(id, m, JSON.stringify(a || {}));
          });
          for (let i = 0; i < 50 && !(window.__efNative && window.__efNative.resolve); i++) await new Promise(r => setTimeout(r, 100));
          const r = {};
          try {
            r.info = await call('info');
            r.permissions = await call('permissions');
            r.key = (await call('deviceKey')).key.length;
            r.attest = await call('attest', { nonce: 'abc' });
            r.dry = await call('protection.dryRun', { level: 'ios-l0' });
            r.l1dry = await call('protection.dryRun', { level: 'ios-l1' });
            r.start = await call('protection.start', { level: 'ios-l0', endsInSec: 60, offlineReleaseSec: 900, preJoin: false });
            r.state = await call('protection.state');
            r.stop = await call('protection.stop', { reason: 'test' });
            r.bad = await call('nope').catch(e => 'err:' + e);
            r.ext = await call('openExternal', { url: 'ftp://x' });
          } catch (e) { r.error = String(e); }
          return JSON.stringify(r);
        })()
        """
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            var text = ""
            switch result { case .success(let v): text = (v as? String) ?? "null"; case .failure(let e): text = "FAIL \(e)" }
            try? text.write(toFile: out, atomically: true, encoding: .utf8)
        }
    }
    #endif
}
