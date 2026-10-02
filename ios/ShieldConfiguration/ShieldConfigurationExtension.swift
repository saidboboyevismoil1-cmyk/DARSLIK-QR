import ManagedSettings
import ManagedSettingsUI
import UIKit

/// Dars vaqtida to'silgan ilova ustida chiqadigan ekran matni (Apple tasdiqlagandan keyin yoqiladi — project-l2.yml).
class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    private func config() -> ShieldConfiguration {
        let lang = Locale.current.language.languageCode?.identifier ?? "uz"
        let (title, sub) = lang == "ru" ? ("Идёт занятие", "Это приложение недоступно, пока преподаватель не разрешит. Вернитесь в EduFocus.")
            : lang == "en" ? ("Class in progress", "This app is unavailable until your teacher allows it. Return to EduFocus.")
            : ("Dars davom etmoqda", "Ustoz ruxsat bermaguncha bu ilova ochilmaydi. EduFocus'ga qayting.")
        return ShieldConfiguration(backgroundBlurStyle: .systemMaterial, title: ShieldConfiguration.Label(text: title, color: .label),
                                   subtitle: ShieldConfiguration.Label(text: sub, color: .secondaryLabel))
    }
    override func configuration(shielding application: Application) -> ShieldConfiguration { config() }
    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration { config() }
    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration { config() }
    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration { config() }
}
