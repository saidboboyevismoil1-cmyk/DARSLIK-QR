import UIKit
import AVFoundation

/// Native QR skaner (AVFoundation). Natija: {text} | {cancelled:true} | {error:"permission_denied"|"no_camera"}.
final class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?
    private var finished = false
    var completion: (([String: Any]) -> Void)?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let close = UIButton(type: .system)
        close.setTitle(NSLocalizedString("scan_cancel", comment: ""), for: .normal)
        close.setTitleColor(.white, for: .normal)
        close.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        close.addTarget(self, action: #selector(cancel), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(close)
        NSLayoutConstraint.activate([close.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
                                     close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12)])
        let hint = UILabel()
        hint.text = NSLocalizedString("scan_hint", comment: "")
        hint.textColor = .white; hint.textAlignment = .center; hint.numberOfLines = 0
        hint.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hint)
        NSLayoutConstraint.activate([hint.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
                                     hint.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
                                     hint.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -32)])
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: configure()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { ok in DispatchQueue.main.async { ok ? self.configure() : self.finish(["error": "permission_denied"]) } }
        default: finish(["error": "permission_denied"])
        }
    }

    private func configure() {
        guard let dev = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: dev),
              session.canAddInput(input) else { finish(["error": "no_camera"]); return }
        session.addInput(input)
        let out = AVCaptureMetadataOutput()
        guard session.canAddOutput(out) else { finish(["error": "no_camera"]); return }
        session.addOutput(out)
        out.setMetadataObjectsDelegate(self, queue: .main)
        out.metadataObjectTypes = [.qr]
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        preview = layer
        DispatchQueue.global(qos: .userInitiated).async { self.session.startRunning() }
    }

    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); preview?.frame = view.bounds }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objs: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let o = objs.first as? AVMetadataMachineReadableCodeObject, let text = o.stringValue else { return }
        finish(["text": text])
    }

    @objc private func cancel() { finish(["cancelled": true]) }

    private func finish(_ result: [String: Any]) {
        guard !finished else { return }
        finished = true
        if session.isRunning { session.stopRunning() }
        let cb = completion; completion = nil
        dismiss(animated: true) { cb?(result) }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if !finished { finished = true; let cb = completion; completion = nil; cb?(["cancelled": true]) }
    }
}
