import Foundation
import CryptoKit
import DeviceCheck

/// Apple App Attest. Server `verifyAppAttest` bilan mos: clientDataHash = SHA256(utf8(nonce)); token = attestation obyekti (base64).
/// Har qo'shilishda yangi kalit yaratiladi (server har safar attestatsiyani to'liq tekshiradi).
enum AppAttest {
    static func attest(nonce: String, completion: @escaping ([String: Any]) -> Void) {
        #if targetEnvironment(simulator)
        // Simulyatorda App Attest yo'q. Faqat server ATTESTATION_MODE=mock bo'lganda (test) qabul qilinadi.
        completion(["token": "mock-ok:\(nonce)", "keyId": "simulator"])
        #else
        let svc = DCAppAttestService.shared
        guard svc.isSupported else { completion(["error": "unsupported"]); return }
        svc.generateKey { keyId, err in
            guard let keyId = keyId else { completion(["error": "keygen:\((err as NSError?)?.code ?? -1)"]); return }
            let hash = Data(SHA256.hash(data: Data(nonce.utf8)))
            svc.attestKey(keyId, clientDataHash: hash) { obj, err in
                guard let obj = obj else { completion(["error": "attest:\((err as NSError?)?.code ?? -1)"]); return }
                completion(["token": obj.base64EncodedString(), "keyId": keyId])
            }
        }
        #endif
    }
}
