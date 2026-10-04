import Foundation
@main struct Check {
 static func main() {
  let size = DuoOutput.size
  precondition(size.width == 3420 && size.height == 3420, "Duo review output must preserve native screen density at every body rotation")
  let source = FrameScaler(maxDimension: DuoOutput.maxEncodedDimension).targetSize(width: size.width, height: size.height)
  precondition(source.width == size.width && source.height == size.height, "Native Duo output must reach the encoder without downscaling")
  for scale in [0.5, 1.0, 2.0] {
   precondition(DuoOutput.renderScale(for: scale) == 0.85, "Resizing the web device must not reduce captured screen density")
  }
  print("Duo native-density output self-test passed")
 }
}
