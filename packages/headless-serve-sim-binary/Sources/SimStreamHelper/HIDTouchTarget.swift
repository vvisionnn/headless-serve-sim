import Foundation

/// Only capture-validated Integrated display IDs may reach this selector.
/// TVOut and other unregistered targets can crash the guest's input service.
enum HIDTouchTarget {
    static func select(displayID: Int?) -> UInt32 {
        guard let displayID, displayID > 0, displayID < 0x40000000 else { return 0x32 }
        return 0x40000000 | UInt32(displayID)
    }
}

/// Keeps a finger on the digitizer, and in the rotation, it went down on. The
/// active display can switch mid-gesture (a Duo folding, a rotation landing);
/// resolving each message afresh would put the begin on one panel and the end
/// on another, leaving a finger stuck down on the first.
struct HIDTouchPin {
    struct Route: Equatable {
        let target: UInt32
        let rotation: Int
    }

    private var pinned: Route?

    mutating func resolve(type: String, current: Route) -> Route {
        if type == "begin" { pinned = current }
        let route = pinned ?? current
        if type == "end" { pinned = nil }
        return route
    }
}
