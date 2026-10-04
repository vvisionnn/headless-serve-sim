#import <Foundation/Foundation.h>
#include <math.h>
#include <stdio.h>
#include <mach/mach_time.h>
#include <dlfcn.h>
#include <objc/message.h>
#include <unistd.h>

@interface MotionServiceDelegate : NSObject
@property(nonatomic, strong) NSDictionary *properties;
@end
@implementation MotionServiceDelegate
- (id)propertyForKey:(NSString *)key forService:(id)service { return self.properties[key]; }
- (BOOL)setProperty:(id)value forKey:(NSString *)key forService:(id)service { return YES; }
- (id)copyEventMatching:(id)matching forService:(id)service { return nil; }
- (BOOL)setOutputEvent:(id)event forService:(id)service { return YES; }
- (void)notification:(uint32_t)type withProperty:(id)property forService:(id)service {}
@end

static id motionService(MotionServiceDelegate *delegate, BOOL consumer) {
    dlopen("/System/Library/PrivateFrameworks/HID.framework/HID", RTLD_NOW);
    id service = [NSClassFromString(@"HIDVirtualEventService") new];
    if (!service) return nil;
    delegate.properties = @{@"PrimaryUsagePage": consumer ? @0x0b : @0xff61, @"PrimaryUsage": consumer ? @1 : @0x5b,
        @"DeviceUsagePairs": consumer
            ? @[@{@"DeviceUsagePage": @0x0b, @"DeviceUsage": @1}]
            : @[@{@"DeviceUsagePage": @0xff61, @"DeviceUsage": @0x5b}],
        @"Transport": @"CoreDevice", @"Product": consumer ? @"headless-serve-sim buttons" : @"headless-serve-sim motion",
        @"Built-In": @(consumer), @"VendorID": @0, @"ProductID": @0,
        @"VersionNumber": @0, @"ReportInterval": @8000};
    ((void (*)(id, SEL, id))objc_msgSend)(service, sel_registerName("setDelegate:"), delegate);
    ((void (*)(id, SEL, id))objc_msgSend)(service, sel_registerName("setDispatchQueue:"),
        dispatch_queue_create("headless-serve-sim.motion", DISPATCH_QUEUE_SERIAL));
    ((void (*)(id, SEL))objc_msgSend)(service, sel_registerName("activate"));
    if (!((uint64_t (*)(id, SEL))objc_msgSend)(service, sel_registerName("serviceID"))) return nil;
    usleep(300000);
    return service;
}

typedef struct __IOHIDEvent *IOHIDEventRef;
typedef struct __IOHIDEventSystemClient *IOHIDEventSystemClientRef;
extern IOHIDEventRef IOHIDEventCreateVendorDefinedEvent(CFAllocatorRef, uint64_t, uint32_t,
    uint32_t, uint32_t, const uint8_t *, CFIndex, uint32_t);
extern IOHIDEventRef IOHIDEventCreateKeyboardEvent(CFAllocatorRef, uint64_t, uint32_t, uint32_t, Boolean, uint32_t);
extern IOHIDEventSystemClientRef IOHIDEventSystemClientCreateWithType(CFAllocatorRef, int, CFDictionaryRef);
extern CFDataRef IOCFSerialize(CFTypeRef, CFOptionFlags);
typedef struct __IOHIDServiceClient *IOHIDServiceClientRef;
extern CFArrayRef IOHIDEventSystemClientCopyServices(IOHIDEventSystemClientRef);
extern CFTypeRef IOHIDServiceClientCopyProperty(IOHIDServiceClientRef, CFStringRef);
extern IOHIDEventRef IOHIDServiceClientCopyEvent(IOHIDServiceClientRef, uint32_t, IOHIDEventRef, uint32_t);
extern uint32_t IOHIDEventGetType(IOHIDEventRef);
extern double IOHIDEventGetFloatValue(IOHIDEventRef, uint32_t);
extern uint64_t IOHIDEventGetTimeStamp(IOHIDEventRef);

static NSNumber *readAngle(IOHIDEventSystemClientRef client, NSNumber **ageMs) {
    CFArrayRef services = IOHIDEventSystemClientCopyServices(client);
    if (!services) return nil;
    NSNumber *angle = nil;
    for (CFIndex i = 0; i < CFArrayGetCount(services); i++) {
        IOHIDServiceClientRef service = (IOHIDServiceClientRef)CFArrayGetValueAtIndex(services, i);
        CFTypeRef product = IOHIDServiceClientCopyProperty(service, CFSTR("Product"));
        BOOL hinge = product && CFEqual(product, CFSTR("CoreMotion_DeviceStateRelay_Crane"));
        if (product) CFRelease(product);
        if (!hinge) continue;
        IOHIDEventRef event = IOHIDServiceClientCopyEvent(service, 44, NULL, 0);
        if (event) {
            if (IOHIDEventGetType(event) == 44) {
                double value = IOHIDEventGetFloatValue(event, (44 << 16) | 1);
                if (isfinite(value) && value >= 0 && value <= 180) {
                    angle = @(value);
                    uint64_t stamp = IOHIDEventGetTimeStamp(event), now = mach_absolute_time();
                    mach_timebase_info_data_t timebase;
                    mach_timebase_info(&timebase);
                    if (stamp && stamp <= now) *ageMs = @((double)(now - stamp) * timebase.numer / timebase.denom / 1e6);
                }
            }
            CFRelease(event);
        }
        if (angle) break;
    }
    CFRelease(services);
    return angle;
}

// Payload adapted from artemnovichkov/hinge (MIT; see LICENSE-hinge).
static BOOL sendMotion(id service, NSString *source, NSString *type, id value) {
    NSDictionary *payload = @{@"provider": @"com.apple.Virtualization.VirtualMachines",
        @"source": source, @"type": type, @"value": value};
    CFDataRef data = IOCFSerialize((__bridge CFTypeRef)payload, 1);
    if (!data) return NO;
    IOHIDEventRef event = IOHIDEventCreateVendorDefinedEvent(NULL, mach_absolute_time(),
        0xFF61, 0x5B, 0, CFDataGetBytePtr(data), CFDataGetLength(data), 0);
    BOOL dispatched = NO;
    if (event) {
        dispatched = ((BOOL (*)(id, SEL, id))objc_msgSend)(service, sel_registerName("dispatchEvent:"), (__bridge id)event);
        CFRelease(event);
    }
    CFRelease(data);
    return dispatched;
}

static BOOL validConsumerRequest(NSDictionary *request) {
    id page = request[@"usagePage"], usage = request[@"usage"], phase = request[@"phase"];
    return [page isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)page) != CFBooleanGetTypeID() && [page doubleValue] == 12 &&
        [usage isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)usage) != CFBooleanGetTypeID() &&
        isfinite([usage doubleValue]) && [usage doubleValue] >= 0 && [usage doubleValue] <= UINT16_MAX && trunc([usage doubleValue]) == [usage doubleValue] &&
        ([phase isEqual:@"down"] || [phase isEqual:@"up"] || [phase isEqual:@"press"]);
}

static BOOL sendConsumer(id service, uint32_t usage, BOOL down) {
    IOHIDEventRef event = IOHIDEventCreateKeyboardEvent(NULL, mach_absolute_time(), 12, usage, down, 0);
    if (!event) return NO;
    BOOL dispatched = ((BOOL (*)(id, SEL, id))objc_msgSend)(service, sel_registerName("dispatchEvent:"), (__bridge id)event);
    CFRelease(event);
    return dispatched;
}

static BOOL sendConsumerRequest(id service, uint32_t usage, NSString *phase, NSMutableSet<NSNumber *> *held) {
    if (![phase isEqual:@"up"]) {
        if (!sendConsumer(service, usage, YES)) return NO;
        [held addObject:@(usage)];
        if ([phase isEqual:@"down"]) return YES;
        usleep(usage == 0x30 || usage == 0xcf ? 250000 : 80000);
    }
    if (!sendConsumer(service, usage, NO)) return NO;
    [held removeObject:@(usage)];
    return YES;
}

static void reply(NSDictionary *message) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
    fwrite(data.bytes, 1, data.length, stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

int main(void) {
    @autoreleasepool {
        MotionServiceDelegate *delegate = [MotionServiceDelegate new];
        id service = motionService(delegate, NO);
        if (!service) {
            fprintf(stderr, "device-motion: failed to create virtual HID service\n");
            return 1;
        }
        MotionServiceDelegate *consumerDelegate = [MotionServiceDelegate new];
        id consumerService = nil;
        NSMutableSet<NSNumber *> *heldConsumers = [NSMutableSet new];
        IOHIDEventSystemClientRef sensors = IOHIDEventSystemClientCreateWithType(NULL, 1, NULL);
        NSNumber *commandedAngle = nil;
        char *line = NULL;
        size_t capacity = 0;
        while (getline(&line, &capacity, stdin) >= 0) {
            @autoreleasepool {
                NSData *data = [[NSString stringWithUTF8String:line] dataUsingEncoding:NSUTF8StringEncoding];
                id request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
                id identifier = [request isKindOfClass:NSDictionary.class] ? request[@"id"] : nil;
                NSString *error = @"unknown command";
                if (![request isKindOfClass:NSDictionary.class]) {
                    error = @"command must be a JSON object";
                } else if ([request[@"command"] isEqual:@"angle"]) {
                    id angle = request[@"angle"];
                    if (![angle isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)angle) == CFBooleanGetTypeID() ||
                        !isfinite([angle doubleValue]) || [angle doubleValue] < 0 || [angle doubleValue] > 180) {
                        error = @"angle must be a finite number between 0 and 180";
                    } else if (sendMotion(service, @"hinge-slider-control", @"range", @([angle doubleValue]))) {
                        commandedAngle = angle;
                        error = nil;
                    } else {
                        error = @"failed to dispatch hinge HID event";
                    }
                } else if ([request[@"command"] isEqual:@"orientation"]) {
                    NSDictionary *values = @{@"portrait": @"portrait", @"portraitUpsideDown": @"pud",
                        @"landscapeLeft": @"landscape-left", @"landscapeRight": @"landscape-right",
                        @"faceUp": @"face-up", @"faceDown": @"face-down"};
                    NSString *value = [request[@"orientation"] isKindOfClass:NSString.class] ? values[request[@"orientation"]] : nil;
                    if (!value) error = @"unknown orientation";
                    else error = sendMotion(service, @"orientation-picker-control", @"enum", value) ? nil : @"failed to dispatch orientation HID event";
                } else if ([request[@"command"] isEqual:@"consumer"]) {
                    if (!validConsumerRequest(request)) error = @"invalid consumer HID event";
                    else {
                        if (!consumerService) consumerService = motionService(consumerDelegate, YES);
                        if (!consumerService) error = @"failed to create consumer HID service";
                        else error = sendConsumerRequest(consumerService, [request[@"usage"] unsignedIntValue], request[@"phase"], heldConsumers)
                            ? nil : @"failed to dispatch consumer HID event";
                    }
                } else if ([request[@"command"] isEqual:@"status"]) {
                    error = nil;
                }
                if (!error) {
                    NSNumber *ageMs = nil;
                    NSNumber *observedAngle = sensors ? readAngle(sensors, &ageMs) : nil;
                    reply(@{@"id": identifier ?: NSNull.null, @"ok": @YES,
                        @"commandedAngle": commandedAngle ?: NSNull.null, @"observedAngle": observedAngle ?: NSNull.null,
                        @"observedAgeMs": ageMs ?: NSNull.null});
                    continue;
                }
                reply(@{@"id": identifier ?: NSNull.null, @"ok": @NO, @"error": error});
            }
        }
        free(line);
        if (consumerService) {
            for (NSNumber *usage in heldConsumers) sendConsumer(consumerService, usage.unsignedIntValue, NO);
            ((void (*)(id, SEL))objc_msgSend)(consumerService, sel_registerName("cancel"));
        }
        ((void (*)(id, SEL))objc_msgSend)(service, sel_registerName("cancel"));
        if (sensors) CFRelease(sensors);
    }
    return 0;
}
