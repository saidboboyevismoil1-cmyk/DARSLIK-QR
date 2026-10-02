import Foundation

/// Funksiya bayroqlari. Qiymatlar Info.plist dagi EFIosL1Enabled / EFIosL2Enabled kalitlaridan olinadi
/// (project.yml → IOS_L1_ENABLED / IOS_L2_ENABLED, standart: NO).
/// Apple entitlement'lari kelmaguncha ikkalasi ham o'chiq — ilova L0 da ishlaydi.
enum Flags {
    static var l1: Bool { bool("EFIosL1Enabled") }
    static var l2: Bool { bool("EFIosL2Enabled") }

    private static func bool(_ key: String) -> Bool {
        if let v = Bundle.main.object(forInfoDictionaryKey: key) as? Bool { return v }
        if let s = Bundle.main.object(forInfoDictionaryKey: key) as? String { return ["yes", "true", "1"].contains(s.lowercased()) }
        return false
    }
}
