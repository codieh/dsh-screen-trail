import AppKit
import CoreImage
import CryptoKit
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

let surfaceMarker = "[dsh-screen-trail]"
let once = CommandLine.arguments.contains("--once")
let outputLock = NSLock()

func send(_ value: [String: Any]) {
    outputLock.lock()
    defer { outputLock.unlock() }
    do {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    } catch {
        FileHandle.standardError.write(Data("capture protocol write failed: \(error)\n".utf8))
        exit(1)
    }
}

func fail(_ message: String, error: Error? = nil) -> Never {
    var payload: [String: Any] = ["type": "error", "message": message]
    if let error = error as NSError? { payload["domain"] = error.domain; payload["code"] = error.code }
    send(payload)
    exit(1)
}

// 采样周期直接传到 ScreenCaptureKit；非法参数必须报错，不能静默恢复为默认值。
let sampleIntervalSec: Int64
if let argument = CommandLine.arguments.first(where: { $0.hasPrefix("--sample-interval-sec=") }) {
    guard let value = Int64(String(argument.dropFirst("--sample-interval-sec=".count))), value > 0 else {
        fail("Sample interval must be a positive integer in seconds")
    }
    sampleIntervalSec = value
} else { sampleIntervalSec = 5 }

func sourceUnavailable(_ error: Error) -> Bool {
    let error = error as NSError
    return error.domain == SCStreamError.errorDomain && [SCStreamError.Code.noCaptureSource.rawValue,
        SCStreamError.Code.noDisplayList.rawValue, SCStreamError.Code.noWindowList.rawValue].contains(error.code)
}

func primaryScreenAwake() -> Bool {
    let display = CGMainDisplayID()
    return display != kCGNullDirectDisplay && CGDisplayIsOnline(display) != 0
        && CGDisplayIsActive(display) != 0 && CGDisplayIsAsleep(display) == 0
}

func event(_ type: String, reason: String, error: Error? = nil) {
    var payload: [String: Any] = ["type": type, "at": Int64(Date().timeIntervalSince1970 * 1000), "reason": reason]
    if let error = error as NSError? { payload["domain"] = error.domain; payload["code"] = error.code; payload["message"] = error.localizedDescription }
    send(payload)
}

// 只读取应用及窗口身份，不访问 AX 正文、不监听按键、不运行 OCR。
func context() -> [String: Any] {
    let read = { () -> [String: Any] in
        guard let app = NSWorkspace.shared.frontmostApplication else { return [:] }
        var result: [String: Any] = ["app": app.localizedName ?? "", "bundleId": app.bundleIdentifier ?? "", "pid": app.processIdentifier]
        if let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
           let window = windows.first(where: { ($0[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier && ($0[kCGWindowLayer as String] as? Int) == 0 }) {
            result["windowId"] = window[kCGWindowNumber as String]
            result["title"] = window[kCGWindowName as String] as? String ?? ""
        }
        return result
    }
    return Thread.isMainThread ? read() : DispatchQueue.main.sync(execute: read)
}

if CommandLine.arguments.contains("--self-test") {
    precondition("Harness \(surfaceMarker)".contains(surfaceMarker))
    precondition(!"Harness Chat".contains(surfaceMarker))
    precondition(sourceUnavailable(NSError(domain: SCStreamError.errorDomain, code: SCStreamError.Code.noCaptureSource.rawValue)))
    precondition(!sourceUnavailable(NSError(domain: SCStreamError.errorDomain, code: SCStreamError.Code.userDeclined.rawValue)))
    precondition(!sourceUnavailable(NSError(domain: SCStreamError.errorDomain, code: SCStreamError.Code.userStopped.rawValue)))
    precondition(!sourceUnavailable(NSError(domain: "Other", code: SCStreamError.Code.noCaptureSource.rawValue)))
    send(["type": "self-test", "ok": true, "sampleIntervalSec": sampleIntervalSec, "screenAwake": primaryScreenAwake(),
          "screenPermission": CGPreflightScreenCaptureAccess()])
    exit(0)
}

@available(macOS 12.3, *)
// 帧和休眠状态只在 frameQueue 读写；每次亮屏由控制器重启辅助进程，不复用旧采集源。
final class Capture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    var stream: SCStream?
    let frameQueue = DispatchQueue(label: "screen-trail.frames")
    var started = false
    var firstSample: CMSampleBuffer?
    var waitingForScreen = false
    var wakeRequested = false
    var screenCheck: DispatchSourceTimer?
    var notifications: [NSObjectProtocol] = []
    let images = CIContext(options: [.cacheIntermediates: false])
    let colors = CGColorSpace(name: CGColorSpace.sRGB)!
    var lastSent = -Double.infinity
    let dimension: Int
    let isScreenAwake: () -> Bool

    init(dimension: Int, isScreenAwake: @escaping () -> Bool = primaryScreenAwake) {
        self.dimension = dimension; self.isScreenAwake = isScreenAwake
    }

    func watchScreen() {
        guard !once else { return }
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.screensDidSleepNotification, NSWorkspace.willSleepNotification] {
            notifications.append(center.addObserver(forName: name, object: nil, queue: nil) { [weak self] notification in
                let reason = notification.name.rawValue
                guard let self = self else { return }
                self.frameQueue.async { self.waitForScreen(reason: reason) }
            })
        }
        // 通知只触发状态核对；后台唤醒时屏幕未亮，不能重启采集。
        for name in [NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification] {
            notifications.append(center.addObserver(forName: name, object: nil, queue: nil) { [weak self] notification in
                let reason = notification.name.rawValue
                guard let self = self else { return }
                self.frameQueue.async { self.checkScreen(reason: reason) }
            })
        }
    }

    func checkScreen(reason: String) {
        guard waitingForScreen, !wakeRequested else { return }
        let awake = isScreenAwake()
        if reason != "screen-state-check" || awake {
            send(["type": "diagnostic", "at": Int64(Date().timeIntervalSince1970 * 1000),
                  "reason": "capture.screen_state", "trigger": reason, "awake": awake])
        }
        guard awake else { return }
        wakeRequested = true
        event("wake", reason: reason)
    }

    func watchWaitingScreen() {
        guard screenCheck == nil else { return }
        // 只等待时核对系统状态，不截图；不依赖某一次亮屏通知恰好到达。
        let timer = DispatchSource.makeTimerSource(queue: frameQueue)
        timer.schedule(deadline: .now() + .seconds(2), repeating: .seconds(2), leeway: .milliseconds(100))
        timer.setEventHandler { [weak self] in self?.checkScreen(reason: "screen-state-check") }
        screenCheck = timer; timer.resume()
    }

    func stopStream(_ active: SCStream) {
        active.stopCapture { error in
            guard let error = error else { return }
            let value = error as NSError
            // 系统停止流和应用停流可能同时发生；明确记录已停止的结果，不吞掉其他错误。
            if sourceUnavailable(error) || (value.domain == SCStreamError.errorDomain && value.code == SCStreamError.Code.attemptToStopStreamState.rawValue) {
                event("diagnostic", reason: "capture.stop_already_ended", error: error)
            } else { fail("ScreenCaptureKit stop failed: \(error.localizedDescription)", error: error) }
        }
    }

    func waitForScreen(reason: String, error: Error? = nil) {
        if once { fail("Screen is unavailable for a manual capture", error: error) }
        let wasStarted = started; let alreadyWaiting = waitingForScreen
        waitingForScreen = true; started = false; firstSample = nil
        // 新的休眠通知会取消控制器尚未执行的亮屏恢复；重复的源失效错误只记诊断。
        if !alreadyWaiting || error == nil {
            wakeRequested = false
            event("waiting", reason: reason, error: error)
        }
        else if let error = error { event("diagnostic", reason: "capture.source_stopped_while_waiting", error: error) }
        watchWaitingScreen()
        // 源失效可能晚于亮屏，此时立即核对，而不是等下一次亮屏事件。
        if error != nil { checkScreen(reason: reason) }
        if error == nil, wasStarted, let active = stream { stopStream(active) }
    }

    func start() async throws {
        if !isScreenAwake() {
            frameQueue.async { self.waitForScreen(reason: "screen-unavailable") }
            return
        }
        let available = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = available.displays.first(where: { $0.displayID == CGMainDisplayID() }) else {
            throw NSError(domain: "ScreenTrail", code: 1, userInfo: [NSLocalizedDescriptionKey: "Primary display is unavailable"])
        }
        let ratio = min(1, Double(dimension) / Double(max(display.width, display.height)))
        let config = SCStreamConfiguration()
        config.width = max(1, Int(Double(display.width) * ratio))
        config.height = max(1, Int(Double(display.height) * ratio))
        config.minimumFrameInterval = CMTime(value: sampleIntervalSec, timescale: 1)
        config.queueDepth = 3
        config.showsCursor = false
        config.capturesAudio = false
        config.pixelFormat = kCVPixelFormatType_32BGRA
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let active = SCStream(filter: filter, configuration: config, delegate: self)
        stream = active
        try active.addStreamOutput(self, type: .screen, sampleHandlerQueue: frameQueue)
        try await active.startCapture()
        let displayId = display.displayID
        // 第一帧可能先于 startCapture 返回，协议仍必须先 ready 再交付帧。
        frameQueue.async {
            if self.waitingForScreen { if let active = self.stream { self.stopStream(active) }; return }
            self.started = true
            send(["type": "ready", "sampleIntervalSec": sampleIntervalSec, "displayId": displayId])
            if let sample = self.firstSample, let active = self.stream {
                self.firstSample = nil
                self.stream(active, didOutputSampleBuffer: sample, of: .screen)
            }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        frameQueue.async {
            if sourceUnavailable(error) { self.waitForScreen(reason: "source-unavailable", error: error) }
            else { fail("ScreenCaptureKit stopped: \(error.localizedDescription)", error: error) }
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard !waitingForScreen, outputType == .screen, sampleBuffer.isValid else { return }
        guard started else { if firstSample == nil { firstSample = sampleBuffer }; return }
        guard let array = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let attachment = array.first, let rawStatus = attachment[.status] as? Int,
              let status = SCFrameStatus(rawValue: rawStatus) else { fail("ScreenCaptureKit frame metadata is missing") }
        guard status == .complete || status == .idle else { return }
        let tick = ProcessInfo.processInfo.systemUptime
        // 容忍轻微回调抖动，避免系统稍早交付一帧就多跳过整个采样周期。
        guard tick - lastSent >= Double(sampleIntervalSec) - 0.01 else { return }
        lastSent = tick
        let now = Date().timeIntervalSince1970
        autoreleasepool {
            let owner = context()
            let at = Int64(now * 1000)
            // 页面在挂载时设置窗口标记；编码及模型请求之前就排除回放页面。
            if (owner["title"] as? String ?? "").contains(surfaceMarker) {
                send(["type": "excluded", "at": at, "context": owner, "reason": "self-surface"])
                if once { exit(0) }
                return
            }
            if status == .idle {
                send(["type": "idle", "at": at, "context": owner])
                return
            }
            guard let pixels = sampleBuffer.imageBuffer,
                  let image = images.createCGImage(CIImage(cvPixelBuffer: pixels), from: CIImage(cvPixelBuffer: pixels).extent) else {
                fail("ScreenCaptureKit pixel buffer is unavailable")
            }
            let data = NSMutableData()
            guard let encoder = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { fail("JPEG encoder is unavailable") }
            CGImageDestinationAddImage(encoder, image, [kCGImageDestinationLossyCompressionQuality: 0.75] as CFDictionary)
            guard CGImageDestinationFinalize(encoder) else { fail("JPEG encoding failed") }
            let jpeg = data as Data
            let ratio = min(1, 256.0 / Double(max(image.width, image.height)))
            let width = max(1, Int(Double(image.width) * ratio))
            let height = max(1, Int(Double(image.height) * ratio))
            var rgba = [UInt8](repeating: 0, count: width * height * 4)
            let drawn = rgba.withUnsafeMutableBytes { memory -> Bool in
                guard let drawing = CGContext(data: memory.baseAddress, width: width, height: height, bitsPerComponent: 8,
                    bytesPerRow: width * 4, space: colors, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
                drawing.interpolationQuality = .medium
                drawing.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
                return true
            }
            guard drawn else { fail("Frame comparison thumbnail failed") }
            send(["type": "frame", "at": at, "context": owner,
                "imageId": SHA256.hash(data: jpeg).map { String(format: "%02x", $0) }.joined(),
                "jpeg": jpeg.base64EncodedString(), "width": width, "height": height,
                "rgba": Data(rgba).base64EncodedString()])
            if once { exit(0) }
        }
    }
}

// 只在本进程发送测试通知，不熄屏、不截屏，也不请求录屏权限。
if CommandLine.arguments.contains("--self-test-screen-events") {
    if #available(macOS 12.3, *) {
        var awake = false
        let capture = Capture(dimension: 1600, isScreenAwake: { awake })
        capture.watchScreen()
        for name in [NSWorkspace.screensDidSleepNotification, NSWorkspace.willSleepNotification,
                     NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification] {
            if name == NSWorkspace.screensDidWakeNotification { capture.frameQueue.sync { awake = true } }
            NSWorkspace.shared.notificationCenter.post(name: name, object: nil)
            capture.frameQueue.sync {}
        }
        capture.frameQueue.sync {
            precondition(capture.wakeRequested)
            capture.checkScreen(reason: "duplicate-wake")
            capture.screenCheck?.cancel()
        }
        exit(0)
    } else { fail("Screen Trail requires macOS 12.3 or later") }
}

// 注入屏幕状态并运行真实的两秒检查定时器，不改变显示器电源，也不启动录屏。
if CommandLine.arguments.contains("--self-test-screen-check") {
    if #available(macOS 12.3, *) {
        var awake = true
        let capture = Capture(dimension: 1600, isScreenAwake: { awake })
        capture.frameQueue.sync {
            capture.checkScreen(reason: "early-wake")
            precondition(!capture.wakeRequested)
            capture.waitForScreen(reason: "source-unavailable", error: NSError(
                domain: SCStreamError.errorDomain, code: SCStreamError.Code.noCaptureSource.rawValue))
            precondition(capture.wakeRequested)
            awake = false
            capture.waitForScreen(reason: "self-test-sleep")
            capture.checkScreen(reason: "background-wake")
            precondition(!capture.wakeRequested)
            awake = true
        }
        RunLoop.main.run(until: Date().addingTimeInterval(2.5))
        capture.frameQueue.sync {
            precondition(capture.wakeRequested, "missed wake notification was not recovered by the screen-state timer")
            capture.screenCheck?.cancel()
        }
        send(["type": "self-test-screen-check", "ok": true, "intervalSec": 2])
        exit(0)
    } else { fail("Screen Trail requires macOS 12.3 or later") }
}

let argument = CommandLine.arguments.first(where: { $0.hasPrefix("--dimension=") })?.split(separator: "=").last
let dimension = argument.flatMap { Int($0) } ?? 1600
guard (480...4096).contains(dimension) else { fail("Invalid capture dimension") }
// 自动恢复只检查权限，不反复弹出系统授权；用户主动开始时仍可请求授权。
let canRequestPermission = !CommandLine.arguments.contains("--no-permission-prompt")
guard CGPreflightScreenCaptureAccess() || (canRequestPermission && CGRequestScreenCaptureAccess()) else { fail("Screen Recording permission is required for DeepSeek Harness or the Screen Trail helper. Enable it in System Settings, then restart recording.") }
if #available(macOS 12.3, *) {
    let capture = Capture(dimension: dimension)
    capture.watchScreen()
    Task {
        do { try await capture.start() }
        catch { fail("ScreenCaptureKit start failed: \(error.localizedDescription)", error: error) }
    }
    withExtendedLifetime(capture) { RunLoop.main.run() }
} else { fail("Screen Trail requires macOS 12.3 or later") }
