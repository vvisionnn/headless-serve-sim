import Foundation
@main struct Check {
 static func main() {
  precondition(DuoOutput.side(requested: nil) == DuoOutput.defaultSide, "No viewer report uses the default side")
  precondition(DuoOutput.side(requested: 100) == DuoOutput.minimumSide, "Tiny viewers are clamped up")
  precondition(DuoOutput.side(requested: 99_999) == DuoOutput.maximumSide, "Huge viewers are capped")
  precondition(DuoOutput.side(requested: 1500) == 1536, "Requests round up to the 128 px step")
  precondition(DuoOutput.side(requested: 1536) == 1536, "Exact steps are kept")
  // Low-latency H.264 emits nothing past a 4K UHD frame (8,294,400 px).
  precondition(DuoOutput.maximumSide * DuoOutput.maximumSide <= 3840 * 2160, "Maximum side must fit a 4K UHD frame")
  for side in [DuoOutput.minimumSide, DuoOutput.defaultSide, DuoOutput.maximumSide] {
   precondition(side % 16 == 0, "Every side is macroblock-aligned")
   let target = FrameScaler(maxDimension: DuoOutput.maximumSide).targetSize(width: side, height: side)
   precondition(target.width == side && target.height == side, "Duo output reaches the encoder unscaled")
  }
  precondition(DuoOutput.renderScale(for: 2.0) == 0.85, "Zoom changes the output side, not the occupancy")
  print("Duo output self-test passed")
 }
}
