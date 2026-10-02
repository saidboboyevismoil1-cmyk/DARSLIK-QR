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

        // Web tomoni window.AndroidBridge / window.iOSBridge orqali native funksiyalarni chaqiradi.
        let bridge = """
        (function () {
          function post(action, value) { window.webkit.messageHandlers.nativeBridge.postMessage({ action: action, value: value }); }
          window.iOSBridge = {
            isNativeApp: function () { return true; },
            startKioskMode: function () { post('startKiosk'); },
            stopKioskMode: function () { post('stopKiosk'); },
            setSystemBarsDark: function (dark) { post('setDark', !!dark); },
            setPullToRefresh: function (on) { post('pullToRefresh', !!on); },
            retry: function () { post('retry'); },
            getServerUrl: function () { return location.origin; }
          };
          if (!window.AndroidBridge) { window.AndroidBridge = window.iOSBridge; }   // offline.html shu nom bilan chaqiradi
        })();
        """
        controller.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let cfg = WKWebViewConfiguration()
        cfg.userContentController = controller
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.applicationNameForUserAgent = "EduFocusApp/4.0"
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
    private func setPullToRefresh(_ enabled: Bool) {
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
            if kioskActive {
                decisionHandler(.cancel)
            } else {
                decisionHandler(.cancel)
                UIApplication.shared.open(url)
            }
            return
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshControl.endRefreshing()
        if !isShowingOffline { hideSplash() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { handleLoadError(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { handleLoadError(error) }

    private func handleLoadError(_ error: Error) {
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
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeBridge", let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        // Faqat o'z serverimiz yoki offline sahifadan keladigan xabarlar qabul qilinadi
        if let host = message.frameInfo.request.url?.host, host != serverHost { return }

        switch action {
        case "startKiosk":
            kioskActive = true
            setNeedsUpdateOfHomeIndicatorAutoHidden()
            // Guided Access faqat nazoratdagi (supervised/MDM) qurilmalarda ishlaydi; oddiy qurilmada e'tiborga olinmaydi
            UIAccessibility.requestGuidedAccessSession(enabled: true) { _ in }
        case "stopKiosk":
            kioskActive = false
            setNeedsUpdateOfHomeIndicatorAutoHidden()
            UIAccessibility.requestGuidedAccessSession(enabled: false) { _ in }
        case "setDark":
            let dark = (body["value"] as? Bool) ?? false
            view.window?.overrideUserInterfaceStyle = dark ? .dark : .light   // status bar va launch rang mavzuga mos
        case "pullToRefresh":
            setPullToRefresh((body["value"] as? Bool) ?? false)
        case "retry":
            load()
        default:
            break
        }
    }
}
