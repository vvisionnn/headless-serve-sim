#import <Foundation/Foundation.h>
#import <objc/message.h>
#import <objc/runtime.h>
#include <dlfcn.h>
#include <stdio.h>
#include <poll.h>
#include <signal.h>
#include <unistd.h>
#include <errno.h>
#include <stdlib.h>
#include <math.h>
#import <dispatch/dispatch.h>

typedef const void *HIDRef;
extern HIDRef IOHIDEventSystemClientCreateWithType(CFAllocatorRef, int, CFDictionaryRef);
extern CFArrayRef IOHIDEventSystemClientCopyServices(HIDRef);
extern CFTypeRef IOHIDServiceClientCopyProperty(HIDRef, CFStringRef);
extern CFTypeRef IOHIDServiceClientCopyEvent(HIDRef, uint32_t, HIDRef, uint32_t);
extern double IOHIDEventGetFloatValue(HIDRef, uint32_t);

static NSNumber *readHinge(HIDRef client) {
    if (!client) return nil;
    CFArrayRef services = IOHIDEventSystemClientCopyServices(client);
    if (!services) return nil;
    NSNumber *angle = nil;
    for (CFIndex i = 0; i < CFArrayGetCount(services); i++) {
        HIDRef service = CFArrayGetValueAtIndex(services, i);
        CFTypeRef product = IOHIDServiceClientCopyProperty(service, CFSTR("Product"));
        BOOL hinge = product && CFEqual(product, CFSTR("CoreMotion_DeviceStateRelay_Crane"));
        if (product) CFRelease(product);
        if (!hinge) continue;
        CFTypeRef event = IOHIDServiceClientCopyEvent(service, 44, NULL, 0);
        if (event) { double value = IOHIDEventGetFloatValue(event, (44 << 16) | 1); if (isfinite(value) && value >= 0 && value <= 180) angle = @(value); CFRelease(event); }
        break;
    }
    CFRelease(services);
    return angle;
}

static NSData *snapshotData(NSArray *displays, NSNumber *angle, NSDictionary **previous) {
    NSDictionary *snapshot = @{@"displays": displays, @"hingeAngle": angle ?: NSNull.null};
    if ([snapshot isEqualToDictionary:*previous]) return nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:snapshot options:0 error:NULL];
    if (data) *previous = snapshot;
    return data;
}

static NSArray *readDisplays(Class displayClass) {
    NSMutableArray *result = [NSMutableArray new];
    for (id display in ((id (*)(id, SEL))objc_msgSend)(displayClass, sel_registerName("displays"))) {
        if (![display respondsToSelector:sel_registerName("stateControl")] ||
            ![display respondsToSelector:sel_registerName("displayId")] ||
            ![display respondsToSelector:sel_registerName("currentOrientation")]) continue;
        id control = ((id (*)(id, SEL))objc_msgSend)(display, sel_registerName("stateControl"));
        if (![control respondsToSelector:sel_registerName("displayState")]) continue;
        uint32_t identifier = ((uint32_t (*)(id, SEL))objc_msgSend)(display, sel_registerName("displayId"));
        long long state = ((long long (*)(id, SEL))objc_msgSend)(control, sel_registerName("displayState"));
        NSString *orientation = ((id (*)(id, SEL))objc_msgSend)(display, sel_registerName("currentOrientation"));
        [result addObject:@{@"displayId": @(identifier), @"active": state == 1 ? @YES : @NO, @"state": @(state),
            @"currentOrientation": orientation ?: NSNull.null}];
    }
    [result sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        return [a[@"displayId"] compare:b[@"displayId"]];
    }];
    return result;
}

static void watchInput(void) {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        char buffer[256];
        while (YES) {
            ssize_t count = read(STDIN_FILENO, buffer, sizeof(buffer));
            if (count == 0) exit(0);
            if (count < 0 && errno != EINTR) exit(1);
        }
    });
}

int main(void) {
    @autoreleasepool {
        signal(SIGPIPE, SIG_DFL);
        dlopen("/System/Library/Frameworks/QuartzCore.framework/QuartzCore", RTLD_NOW);
        Class displayClass = NSClassFromString(@"CADisplay");
        if (!displayClass || ![displayClass respondsToSelector:sel_registerName("displays")]) {
            fprintf(stderr, "display-observer: CADisplay is unavailable\n");
            return 1;
        }
        NSDictionary *previous = nil;
        HIDRef sensors = IOHIDEventSystemClientCreateWithType(NULL, 1, NULL);
        watchInput();
        while (YES) {
            @autoreleasepool {
                NSData *data = snapshotData(readDisplays(displayClass), readHinge(sensors), &previous);
                if (data) {
                    if (fwrite(data.bytes, 1, data.length, stdout) != data.length ||
                        fputc('\n', stdout) == EOF || fflush(stdout) == EOF) return 1;
                }
                struct pollfd output = {.fd = STDOUT_FILENO, .events = 0};
                if (poll(&output, 1, 0) > 0 && (output.revents & (POLLERR | POLLHUP | POLLNVAL))) return 0;
                [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:1.0 / 60.0]];
            }
        }
    }
}
