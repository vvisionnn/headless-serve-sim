import Foundation

@main struct MotionTest {
    static func main() {
        var motion = DuoMotion(value: 130, target: 180)
        precondition(motion.step(1.0 / 60))
        precondition(motion.value > 130 && motion.value < 180, "body must pass through intermediate values")
        for _ in 0..<10 { _ = motion.step(1.0 / 60) }
        let velocity = motion.velocity
        motion.target = 0
        _ = motion.step(1.0 / 60)
        precondition(velocity > 0, "motion must preserve measured velocity")
        for _ in 0..<180 { _ = motion.step(1.0 / 60) }
        precondition(motion.value == 0 && motion.velocity == 0)
        var stalled = DuoMotion(value: 0, target: 180)
        _ = stalled.step(10)
        precondition(stalled.value < 30, "long stalls must not skip the complete fold")
        print("Duo motion self-test passed")
    }
}
