#define main deviceMotionMain
#import "../Sources/SimDeviceMotion/sim-device-motion.m"
#undef main

static NSMutableArray<NSDictionary *> *events;
static uint64_t touchInputActive;

uint32_t notify_register_check(const char *name, int *token) { *token = 1; return 0; }
uint32_t notify_get_state(int token, uint64_t *state) { *state = touchInputActive; return 0; }
uint32_t notify_cancel(int token) { return 0; }

IOHIDEventRef IOHIDEventCreateDigitizerEvent(CFAllocatorRef allocator, uint64_t time, uint32_t type, uint32_t index, uint32_t identity, uint32_t mask, uint32_t buttons, double x, double y, double z, double pressure, double twist, Boolean range, Boolean touch, uint32_t options) {
    [events addObject:@{@"touch": @(touch)}];
    return (IOHIDEventRef)CFDataCreate(NULL, NULL, 0);
}
IOHIDEventRef IOHIDEventCreateDigitizerFingerEvent(CFAllocatorRef allocator, uint64_t time, uint32_t index, uint32_t identity, uint32_t mask, double x, double y, double z, double pressure, double twist, Boolean range, Boolean touch, uint32_t options) {
    return (IOHIDEventRef)CFDataCreate(NULL, NULL, 0);
}
void IOHIDEventAppendEvent(IOHIDEventRef parent, IOHIDEventRef child, uint32_t options) {}
void IOHIDEventSetIntegerValue(IOHIDEventRef event, uint32_t field, CFIndex value) {}

IOHIDEventRef IOHIDEventCreateKeyboardEvent(CFAllocatorRef allocator, uint64_t time, uint32_t page, uint32_t usage, Boolean down, uint32_t options) {
    [events addObject:@{@"page": @(page), @"usage": @(usage), @"down": @(down)}];
    return (IOHIDEventRef)CFDataCreate(NULL, NULL, 0);
}

@interface ConsumerTestService : NSObject
@end
@implementation ConsumerTestService
- (BOOL)dispatchEvent:(id)event { return YES; }
@end

int main(void) {
    @autoreleasepool {
        NSDictionary *valid = @{@"usagePage": @12, @"usage": @0x30, @"phase": @"press"};
        NSCAssert(validConsumerRequest(valid), @"valid consumer request rejected");
        for (NSDictionary *change in @[@{@"usagePage": @7}, @{@"usagePage": @YES}, @{@"usage": @(-1)},
             @{@"usage": @65536}, @{@"usage": @0.5}, @{@"usage": @YES}, @{@"usage": @"48"}, @{@"phase": @"hold"}]) {
            NSMutableDictionary *request = [valid mutableCopy];
            [request addEntriesFromDictionary:change];
            NSCAssert(!validConsumerRequest(request), @"invalid consumer request accepted");
        }
        NSDictionary *key = @{ @"usage": @4, @"phase": @"down" };
        NSCAssert(validKeyboardRequest(key), @"valid keyboard event rejected");
        for (NSDictionary *change in @[@{@"usage": @256}, @{@"usage": @(-1)}, @{@"usage": @YES}, @{@"phase": @"press"}]) {
            NSMutableDictionary *request = [key mutableCopy];
            [request addEntriesFromDictionary:change];
            NSCAssert(!validKeyboardRequest(request), @"invalid keyboard event accepted");
        }
        events = [NSMutableArray new];
        id keyboard = [ConsumerTestService new];
        NSMutableSet<NSNumber *> *keys = [NSMutableSet new];
        NSCAssert(sendKeyboardRequest(keyboard, 0xe1, @"down", keys), @"modifier down failed");
        NSCAssert(sendKeyboardRequest(keyboard, 4, @"down", keys), @"key down failed");
        NSCAssert(sendKeyboardRequest(keyboard, 4, @"up", keys), @"key up failed");
        NSCAssert([keys isEqual:[NSSet setWithObject:@0xe1]], @"modifier state lost");
        NSCAssert(sendKeyboardRequest(keyboard, 0xe1, @"up", keys), @"modifier up failed");
        NSCAssert(keys.count == 0 && [events[0][@"page"] isEqual:@7] && events.count == 4, @"keyboard events must use page7 and release keys");
        events = [NSMutableArray new];
        NSMutableSet<NSNumber *> *held = [NSMutableSet new];
        id service = [ConsumerTestService new];
        NSCAssert(sendConsumerRequest(service, 0x30, @"down", held), @"consumer down failed");
        NSCAssert([held containsObject:@0x30] && events.count == 1, @"consumer down was not held");
        NSCAssert(sendConsumerRequest(service, 0x30, @"up", held), @"consumer up failed");
        NSCAssert(held.count == 0 && events.count == 2, @"consumer up did not release");
        NSCAssert(sendConsumerRequest(service, 0xe9, @"press", held), @"consumer press failed");
        NSArray *expected = @[
            @{@"page": @12, @"usage": @0x30, @"down": @YES},
            @{@"page": @12, @"usage": @0x30, @"down": @NO},
            @{@"page": @12, @"usage": @0xe9, @"down": @YES},
            @{@"page": @12, @"usage": @0xe9, @"down": @NO},
        ];
        NSCAssert(held.count == 0 && [events isEqual:expected], @"consumer phases or keyboard event payload changed");
        NSDictionary *touch = @{ @"x": @0.493, @"y": @0.256, @"phase": @"begin" };
        NSCAssert(validTouchRequest(touch), @"valid touchscreen event rejected");
        for (NSDictionary *change in @[@{@"x": @YES}, @{@"x": @(-0.1)}, @{@"y": @1.1}, @{@"y": @"0.5"}, @{@"phase": @"press"}]) {
            NSMutableDictionary *request = [touch mutableCopy];
            [request addEntriesFromDictionary:change];
            NSCAssert(!validTouchRequest(request), @"invalid touchscreen event accepted");
        }
        events = [NSMutableArray new];
        touchInputActive = 0;
        NSCAssert(!sendTouch(service, 0.493, 0.256, @"begin"), @"inactive virtual touchscreen must not claim delivery");
        NSCAssert(events.count == 0, @"inactive virtual touchscreen dispatched a touch");
        touchInputActive = 1;
        NSCAssert(sendTouch(service, 0.493, 0.256, @"begin"), @"active virtual touchscreen rejected touch");
        NSCAssert(events.count == 1, @"active virtual touchscreen did not dispatch touch");
        puts("Device motion consumer self-test passed");
    }
    return 0;
}
