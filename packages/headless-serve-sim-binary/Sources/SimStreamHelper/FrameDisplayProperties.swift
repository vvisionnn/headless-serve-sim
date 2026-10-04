import Foundation
import ObjectiveC

/// Scalar getters must use their real ABI; NSObject.perform returns an object.
enum FrameDisplayProperties {
    private static let msgSend = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "objc_msgSend")

    static func read(_ descriptor: NSObject, width: Int, height: Int, properties: NSObject? = nil) -> FrameDisplayCandidate {
        var candidate = FrameDisplayCandidate(width: width, height: height)
        guard let properties = properties ?? object(descriptor, "screenProperties") else { return candidate }
        candidate.screenID = uint32(properties, "screenID").map(Int.init)
        candidate.screenType = uint64(properties, "screenType")
        candidate.uiOrientation = uint32(properties, "uiOrientation")
        if let backlight = object(properties, "backlight") {
            candidate.backlightState = int32(backlight, "state")
        }
        return candidate
    }

    private static func object(_ object: NSObject, _ name: String) -> NSObject? {
        let selector = NSSelectorFromString(name)
        guard object.responds(to: selector) else { return nil }
        return object.perform(selector)?.takeUnretainedValue() as? NSObject
    }

    private static func uint32(_ object: NSObject, _ name: String) -> UInt32? {
        let selector = NSSelectorFromString(name)
        guard object.responds(to: selector), let msgSend else { return nil }
        typealias Getter = @convention(c) (AnyObject, Selector) -> UInt32
        return unsafeBitCast(msgSend, to: Getter.self)(object, selector)
    }

    private static func uint64(_ object: NSObject, _ name: String) -> UInt64? {
        let selector = NSSelectorFromString(name)
        guard object.responds(to: selector), let msgSend else { return nil }
        typealias Getter = @convention(c) (AnyObject, Selector) -> UInt64
        return unsafeBitCast(msgSend, to: Getter.self)(object, selector)
    }

    private static func int32(_ object: NSObject, _ name: String) -> Int32? {
        let selector = NSSelectorFromString(name)
        guard object.responds(to: selector), let msgSend else { return nil }
        typealias Getter = @convention(c) (AnyObject, Selector) -> Int32
        return unsafeBitCast(msgSend, to: Getter.self)(object, selector)
    }
}
