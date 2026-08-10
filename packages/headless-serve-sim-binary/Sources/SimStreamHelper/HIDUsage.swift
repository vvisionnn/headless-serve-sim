import Foundation

/// USB HID usages for the hardware inputs the simulator understands.
///
/// These are delivered with `IndigoHIDMessageForHIDArbitrary` on the *digitizer*
/// target (`0x32`) — the same target touches use. That matters: Xcode 27 stopped
/// consuming the dedicated hardware-button (`0x33`) and keyboard (`0x64`) Indigo
/// targets, having moved those planes to CoreDevice's virtual HID services, but
/// the digitizer target still accepts arbitrary HID reports on every toolchain
/// we support. Routing buttons and keys as HID usages therefore works on Xcode
/// 26 and 27 alike, with no version sniffing.
enum HIDUsage {
    /// Usage pages (USB HID spec).
    static let consumerPage: UInt32 = 0x0C
    static let keyboardPage: UInt32 = 0x07

    /// Consumer-page usages for the hardware buttons the CLI exposes.
    static let menu: UInt32 = 0x40 // home
    static let power: UInt32 = 0x30 // lock / wake
    static let voiceCommand: UInt32 = 0xCF // siri
    static let volumeUp: UInt32 = 0xE9
    static let volumeDown: UInt32 = 0xEA
    static let mute: UInt32 = 0xE2

    /// Direction values shared by every Indigo HID message builder.
    static let down: UInt32 = 1
    static let up: UInt32 = 2

    /// Consumer usage for a named hardware button, or nil when the name has no
    /// HID equivalent and needs a different mechanism (e.g. `swipe_home`).
    static func consumerUsage(forButton name: String) -> UInt32? {
        switch name {
        case "home": return menu
        case "lock": return power
        case "siri": return voiceCommand
        case "side_button": return power
        case "volume_up": return volumeUp
        case "volume_down": return volumeDown
        default: return nil
        }
    }
}
