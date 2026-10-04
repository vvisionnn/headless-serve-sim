import Foundation

/// Only capture-validated Integrated display IDs may reach this selector.
/// TVOut and other unregistered targets can crash the guest's input service.
enum HIDTouchTarget {
    static func select(displayID: Int?) -> UInt32 {
        guard let displayID, displayID > 0, displayID < 0x40000000 else { return 0x32 }
        return 0x40000000 | UInt32(displayID)
    }
}
