// Lessons, the AI assistant and everything not rebuilt natively yet: the Yaver web app
// running inside the native app. The app passes its sync code in (window.yaverNative),
// so the web part joins the same encrypted sync and shows the same data by itself.
import SwiftUI
import WebKit
#if os(iOS)
import UIKit
#else
import AppKit
#endif

enum WebApp {
    static let base = "https://mskorkmaz08-del.github.io/yaver/"

    static func makeWebView(sync: Sync) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        var info: [String: JSON] = ["native": true]
        #if os(macOS)
        info["platform"] = "mac"
        #else
        info["platform"] = "ios"
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        #endif
        if sync.configured {
            info["syncCode"] = .string(sync.code())
            info["deviceName"] = .string(sync.deviceName + " · lessons")
        }
        let json = (try? JSON.object(info).encoded()).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
        config.userContentController.addUserScript(WKUserScript(source: "window.yaverNative = \(json);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: .zero, configuration: config)
        #if os(macOS)
        view.setValue(false, forKey: "drawsBackground")
        #else
        view.isOpaque = false
        view.backgroundColor = UIColor(red: 0x10 / 255, green: 0x15 / 255, blue: 0x1f / 255, alpha: 1)
        view.scrollView.contentInsetAdjustmentBehavior = .never
        #endif
        return view
    }
}

final class WebCoordinator: NSObject, WKUIDelegate, WKNavigationDelegate {
    #if os(macOS)
    // File pickers (backup import, meal photos) need a panel on the Mac.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.begin { completionHandler($0 == .OK ? panel.urls : nil) }
    }
    #endif

    // Links to other sites open in the browser, not inside Yaver.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, action.navigationType == .linkActivated || action.targetFrame == nil,
           !url.absoluteString.hasPrefix(WebApp.base) {
            #if os(macOS)
            NSWorkspace.shared.open(url)
            #else
            UIApplication.shared.open(url)
            #endif
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            #if os(macOS)
            NSWorkspace.shared.open(url)
            #else
            UIApplication.shared.open(url)
            #endif
        }
        return nil
    }
}

#if os(macOS)
struct WebAppView: NSViewRepresentable {
    @EnvironmentObject var sync: Sync
    let route: String
    func makeCoordinator() -> WebCoordinator { WebCoordinator() }
    func makeNSView(context: Context) -> WKWebView {
        let v = WebApp.makeWebView(sync: sync)
        v.uiDelegate = context.coordinator
        v.navigationDelegate = context.coordinator
        v.load(URLRequest(url: URL(string: WebApp.base + "#" + route)!))
        return v
    }
    func updateNSView(_ v: WKWebView, context: Context) {}
}
#else
struct WebAppView: UIViewRepresentable {
    @EnvironmentObject var sync: Sync
    let route: String
    func makeCoordinator() -> WebCoordinator { WebCoordinator() }
    func makeUIView(context: Context) -> WKWebView {
        let v = WebApp.makeWebView(sync: sync)
        v.uiDelegate = context.coordinator
        v.navigationDelegate = context.coordinator
        v.load(URLRequest(url: URL(string: WebApp.base + "#" + route)!))
        return v
    }
    func updateUIView(_ v: WKWebView, context: Context) {}
}
#endif

/// The Lessons tab: the course, review cards, tests and the AI tutor.
struct LessonsView: View {
    @EnvironmentObject var sync: Sync
    var body: some View {
        WebAppView(route: "course")
            .id(sync.configured) // reload once sync is joined, so the code is handed over
            .background(Theme.bg.ignoresSafeArea())
            #if os(iOS)
            .toolbar(.hidden, for: .navigationBar)
            #endif
    }
}
