// swift-tools-version: 6.2

import PackageDescription

let package = Package(
  name: "sockudo",
  platforms: [
    .iOS(.v13),
    .macOS(.v10_15),
    .tvOS(.v13),
    .watchOS(.v6),
    .visionOS(.v1),
  ],
  products: [
    .library(
      name: "SockudoSwift",
      targets: ["SockudoSwift"]
    ),
    .library(
      name: "Sockudo",
      targets: ["Sockudo"]
    ),
    .library(
      name: "Pusher",
      targets: ["Pusher"]
    ),
  ],
  dependencies: [
    .package(url: "https://github.com/jedisct1/swift-sodium.git", from: "0.9.1"),
    .package(url: "https://github.com/ably/delta-codec-cocoa.git", from: "1.0.0"),
    .package(url: "https://github.com/danielrbrowne/APIota", .upToNextMajor(from: "0.2.0")),
    .package(url: "https://github.com/Flight-School/AnyCodable", .upToNextMajor(from: "0.4.0")),
    .package(url: "https://github.com/apple/swift-crypto", .upToNextMajor(from: "1.1.6")),
    .package(
      url: "https://github.com/bitmark-inc/tweetnacl-swiftwrap",
      revision: "f8fd111642bf2336b11ef9ea828510693106e954"
    ),
    .package(url: "https://github.com/swiftlang/swift-testing.git", from: "0.12.0"),
  ],
  targets: [
    .target(
      name: "SockudoSwift",
      dependencies: [
        .product(name: "Sodium", package: "swift-sodium"),
        .product(name: "AblyDeltaCodec", package: "delta-codec-cocoa"),
      ],
      path: "client-sdks/sockudo-swift/Sources/SockudoSwift",
      swiftSettings: [
        .unsafeFlags(["-Xfrontend", "-strict-concurrency=minimal"])
      ]
    ),
    .target(
      name: "Sockudo",
      dependencies: [
        "APIota",
        "AnyCodable",
        .product(name: "Crypto", package: "swift-crypto"),
        .product(name: "TweetNacl", package: "tweetnacl-swiftwrap"),
      ],
      path: "server-sdks/sockudo-http-swift/Sources/Sockudo",
      swiftSettings: [
        .swiftLanguageMode(.v5),
        .unsafeFlags(["-Xfrontend", "-strict-concurrency=minimal"])
      ]
    ),
    .target(
      name: "Pusher",
      dependencies: [
        "APIota",
        "AnyCodable",
        .product(name: "Crypto", package: "swift-crypto"),
        .product(name: "TweetNacl", package: "tweetnacl-swiftwrap"),
      ],
      path: "server-sdks/sockudo-http-swift/Sources/Pusher",
      swiftSettings: [
        .swiftLanguageMode(.v5),
        .unsafeFlags(["-Xfrontend", "-strict-concurrency=minimal"])
      ]
    ),
    .testTarget(
      name: "SockudoSwiftTests",
      dependencies: [
        "SockudoSwift",
        .product(name: "Testing", package: "swift-testing"),
      ],
      path: "client-sdks/sockudo-swift/Tests/SockudoSwiftTests",
      swiftSettings: [
        .unsafeFlags([
          "-Xfrontend", "-strict-concurrency=minimal",
          "-suppress-warnings",
        ])
      ]
    ),
  ]
)
