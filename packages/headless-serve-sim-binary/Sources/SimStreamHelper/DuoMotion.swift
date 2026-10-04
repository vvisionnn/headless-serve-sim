import Foundation

struct DuoMotion {
    var value: Double
    var velocity: Double = 0
    var target: Double

    mutating func step(_ seconds: Double) -> Bool {
        let dt = min(0.05, max(0, seconds))
        let omega = 2 / 0.25
        let x = omega * dt
        let decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
        let difference = value - target
        let step = (velocity + omega * difference) * dt
        velocity = (velocity - omega * step) * decay
        value = target + (difference + step) * decay
        if abs(value - target) < 0.05 && abs(velocity) < 0.5 {
            value = target
            velocity = 0
            return false
        }
        return true
    }
}
