import Foundation

struct FrameDisplayCandidate {
    let width: Int
    let height: Int
    var screenID: Int? = nil
    var screenType: UInt64? = nil
    var backlightState: Int32? = nil
    var uiOrientation: UInt32? = nil
}

struct FrameDisplayState: Equatable {
    var displayID: Int?
    var rotation: Int
}

struct FrameDisplayBinding {
    private(set) var descriptorID: ObjectIdentifier?
    private(set) var state = FrameDisplayState(displayID: nil, rotation: 0)

    mutating func update(descriptorID: ObjectIdentifier, candidate: FrameDisplayCandidate) -> (bindingChanged: Bool, stateChanged: Bool) {
        let bindingChanged = self.descriptorID != descriptorID
        let next = FrameDisplayState(displayID: candidate.screenID,
                                     rotation: FrameDisplaySelector.rotation(uiOrientation: candidate.uiOrientation))
        let stateChanged = state != next
        self.descriptorID = descriptorID
        state = next
        return (bindingChanged, stateChanged)
    }
}

enum FrameDisplaySelector {
    static func touchDisplayID(_ candidate: FrameDisplayCandidate?, hasMultipleIntegratedDisplays: Bool) -> Int? {
        guard hasMultipleIntegratedDisplays, let candidate,
              candidate.screenType == 0, candidate.width > 0, candidate.height > 0 else { return nil }
        return candidate.screenID
    }

    static func rotation(uiOrientation: UInt32?) -> Int {
        switch uiOrientation {
        case 2: return 180
        case 3: return 270
        case 4: return 90
        default: return 0
        }
    }

    static func select(_ candidates: [FrameDisplayCandidate], activeDisplayID: Int? = nil) -> Int? {
        if let activeDisplayID, let index = candidates.firstIndex(where: {
            $0.screenID == activeDisplayID && $0.width > 0 && $0.height > 0
        }) {
            return index
        }
        var best: Int?
        var bestArea = 0
        var bestActive = false
        for (index, candidate) in candidates.enumerated() {
            guard candidate.width > 0, candidate.height > 0 else { continue }
            let area = candidate.width * candidate.height
            let active = candidate.screenType == 0 && candidate.backlightState == 2
            if best == nil || (active && !bestActive) || (active == bestActive && area > bestArea) {
                best = index
                bestArea = area
                bestActive = active
            }
        }
        return best
    }
}
