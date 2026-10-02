import DeviceActivity
import ManagedSettings

/// Dars intervali tugaganda (ilova o'ldirilgan bo'lsa ham) qalqonni avtomatik olib tashlaydi — "qamalib qolish" bo'lmasligi uchun.
class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        ManagedSettingsStore().clearAllSettings()
    }
}
