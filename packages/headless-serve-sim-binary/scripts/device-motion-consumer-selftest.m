#define main deviceMotionMain
#import "../Sources/SimDeviceMotion/sim-device-motion.m"
#undef main

static NSMutableArray<NSDictionary *> *events;

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
        puts("Device motion consumer self-test passed");
    }
    return 0;
}
