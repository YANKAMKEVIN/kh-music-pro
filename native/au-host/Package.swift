// swift-tools-version:5.9
// Prototype V14b, étape 2 : plus petit hôte Audio Unit possible (fichier WAV → plugin AU → fichier WAV).
import PackageDescription

let package = Package(
    name: "au-host",
    platforms: [.macOS(.v13)],
    targets: [.executableTarget(name: "au-host", path: "Sources")]
)
