import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = (scene as? UIWindowScene) else { return }
        
        let window = UIWindow(windowScene: windowScene)
        window.backgroundColor = UIColor(red: 0.067, green: 0.094, blue: 0.153, alpha: 1.0)
        
        let viewController = ViewController()
        window.rootViewController = viewController
        
        self.window = window
        window.makeKeyAndVisible()
    }
}
