// swift-tools-version:6.2
// Programa de voz do Maestro IA: roda o Qwen3-TTS (Apache-2.0) no Mac com chip Apple, pela
// biblioteca mlx-audio-swift (MIT). Compila com o Xcode 26.3 (o xcodebuild compila os shaders da
// placa de vídeo, que o `swift build` sozinho não compila): scripts/buildMaestroVoiceHelper.sh.
import PackageDescription

let package = Package(
    name: "VSMaestroVoz",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "vs-maestro-voz", targets: ["vs-maestro-voz"]),
    ],
    dependencies: [
        // versão fixa: a mesma que foi conferida (som e velocidade) antes de ir para o app
        .package(url: "https://github.com/Blaizzy/mlx-audio-swift.git", revision: "6fd938669e45412f5c35e011e7086ecd20397dbd"), // v0.1.7
        .package(url: "https://github.com/ml-explore/mlx-swift.git", exact: "0.32.3"),
    ],
    targets: [
        .executableTarget(
            name: "vs-maestro-voz",
            dependencies: [
                .product(name: "MLXAudioCore", package: "mlx-audio-swift"),
                .product(name: "MLXAudioTTS", package: "mlx-audio-swift"),
                .product(name: "MLX", package: "mlx-swift"),
            ],
            path: "Sources/vs-maestro-voz",
            // programa simples, de uma linha de execução só: sem as checagens estritas do Swift 6
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
