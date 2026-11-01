// Programa de voz do Maestro IA (VS Stage).
//
// Roda o Qwen3-TTS (Alibaba, Apache-2.0) no Mac com chip Apple pela mlx-audio-swift (MIT). O app
// abre este programa uma vez, ele carrega o modelo e atende várias falas, uma de cada vez.
//
// Conversa: uma linha JSON por pedido na entrada; cada resposta sai numa linha que começa com
// "@@VS " (o resto do que a biblioteca imprimir é ignorado pelo app).
//   {"id":"1","cmd":"speak","text":"Um!","ref":"/…/feminina.wav","refText":"…","seed":7,
//    "maxTokens":120,"temperature":0.6,"topK":50,"out":"/tmp/…/fala.f32"}
//     → grava as amostras (float 32 bits, mono) em `out` e responde
//       {"id":"1","ok":true,"samples":…,"sampleRate":24000,"elapsed":…}
//   {"id":"2","cmd":"ping"} → {"id":"2","ok":true}
// Ao abrir, depois de carregar o modelo, responde {"id":"ready","ok":true,"sampleRate":…}.
//
// Uso: vs-maestro-voz --model <pasta do modelo>
import Foundation
@preconcurrency import MLX
import MLXAudioCore
import MLXAudioTTS

struct Request: Decodable {
    let id: String
    let cmd: String
    var text: String?
    var ref: String?
    var refText: String?
    var seed: UInt64?
    var maxTokens: Int?
    var temperature: Float?
    var topK: Int?
    var out: String?
    var language: String?
}

struct Reply: Encodable {
    let id: String
    let ok: Bool
    var error: String?
    var samples: Int?
    var sampleRate: Int?
    var elapsed: Double?
}

func send(_ reply: Reply) {
    guard let data = try? JSONEncoder().encode(reply), let json = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write(Data("@@VS \(json)\n".utf8))
}

func argument(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

// Teste no GitHub (máquina virtual, sem a placa de vídeo completa): tudo no processador.
// Tem de vir antes de qualquer coisa do MLX.
if CommandLine.arguments.contains("--cpu") {
    Device.setDefault(device: .cpu)
}

// Mac de 8 GB: o MLX não guarda os pedaços de memória soltos entre uma fala e outra.
Memory.cacheLimit = 64 * 1024 * 1024

guard let modelDir = argument("--model") else {
    send(Reply(id: "ready", ok: false, error: "Falta --model <pasta do modelo>"))
    exit(2)
}

let model: SpeechGenerationModel
do {
    model = try await TTS.loadModel(modelRepo: modelDir)
} catch {
    send(Reply(id: "ready", ok: false, error: "Não foi possível carregar a voz: \(error.localizedDescription)"))
    exit(1)
}
send(Reply(id: "ready", ok: true, sampleRate: model.sampleRate))

// As referências de voz (feminina, masculina) ficam lidas na memória: são as mesmas em toda fala.
var references: [String: MLXArray] = [:]

func reference(_ path: String) throws -> MLXArray {
    if let cached = references[path] { return cached }
    let (_, audio) = try loadAudioArray(from: URL(fileURLWithPath: path), sampleRate: model.sampleRate)
    references[path] = audio
    return audio
}

func writeFloats(_ samples: [Float], to path: String) throws {
    let data = samples.withUnsafeBufferPointer { Data(buffer: $0) }
    try data.write(to: URL(fileURLWithPath: path), options: .atomic)
}

while let line = readLine() {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty { continue }
    guard let req = try? JSONDecoder().decode(Request.self, from: Data(trimmed.utf8)) else {
        send(Reply(id: "?", ok: false, error: "Pedido inválido"))
        continue
    }
    switch req.cmd {
    case "ping":
        send(Reply(id: req.id, ok: true))
    case "speak":
        guard let text = req.text, !text.isEmpty, let out = req.out else {
            send(Reply(id: req.id, ok: false, error: "Faltam o texto ou o arquivo de saída"))
            continue
        }
        let started = Date()
        do {
            // mesma semente → a mesma fala sai igual se for gerada de novo
            MLXRandom.seed(req.seed ?? 7)
            let refAudio = try req.ref.map { try reference($0) }
            var params = model.defaultGenerationParameters
            if let maxTokens = req.maxTokens { params.maxTokens = maxTokens }
            if let temperature = req.temperature { params.temperature = temperature }
            if let topK = req.topK { params.topK = topK }
            let audio = try await model.generate(
                text: text,
                voice: nil,
                refAudio: refAudio,
                refText: req.refText,
                language: req.language ?? "portuguese",
                generationParameters: params
            )
            let samples = audio.asArray(Float.self)
            Memory.clearCache()
            try writeFloats(samples, to: out)
            send(Reply(id: req.id, ok: true, samples: samples.count, sampleRate: model.sampleRate,
                       elapsed: Date().timeIntervalSince(started)))
        } catch {
            send(Reply(id: req.id, ok: false, error: error.localizedDescription))
        }
    default:
        send(Reply(id: req.id, ok: false, error: "Comando desconhecido: \(req.cmd)"))
    }
}
