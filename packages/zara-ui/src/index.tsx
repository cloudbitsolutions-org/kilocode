import { render } from "solid-js/web"
import { Router, Route } from "@solidjs/router"
import ChatApp from "./chat-app/App"
import ConsoleApp from "./console/App"
import { ProjectConsoleRoute } from "./console/routes/projects/ProjectConsoleRoute"
import { ProjectsRoute } from "./console/routes/projects/ProjectsRoute"
import { ProfileRoute } from "./console/routes/profile/ProfileRoute"
import { LoginRoute } from "./console/routes/profile/LoginRoute"
import { ConfigLayout } from "./console/layouts/ConfigLayout"
import { configSections } from "./console/routes/config/sections"
import { setupEmulator } from "./emulator"

// @ts-expect-error missing types for styles
import "@kilocode/kilo-ui/styles"
import "@kilocode/kilo-web-ui/styles"
import "./console/styles.css"

const root = document.getElementById("root")

if (root) {
  // Handle theme override from URL
  const urlParams = new URLSearchParams(window.location.search)
  const themeParam = urlParams.get("theme")
  if (themeParam === "dark" || themeParam === "light") {
    localStorage.setItem("opencode-color-scheme", themeParam)
  }

  // Initialize the VS Code Extension Host API Emulator
  setupEmulator()

  const base = import.meta.env.BASE_URL.replace(/\/$/, "")

  function configRoutes() {
    return configSections.map((item) => <Route path={item.path} component={item.component} />)
  }

  render(
    () => (
      <Router base={base || undefined}>
        <Route path="/" component={ChatApp} />
        <Route path="/chat" component={ChatApp} />
        
        {/* Console Routes wrapped in ConsoleApp layout */}
        <Route path="/" component={ConsoleApp}>
          <Route path="/projects" component={ProjectsRoute} />
          <Route path="/projects/:project" component={ProjectConsoleRoute} />
          <Route path="/projects/:project/settings" component={ConfigLayout}>
            {configRoutes()}
          </Route>
          <Route path="/profile" component={ProfileRoute} />
          <Route path="/kilo/login" component={LoginRoute} />
          <Route path="/settings" component={ConfigLayout}>
            {configRoutes()}
          </Route>
          <Route path="/config" component={ConfigLayout}>
            {configRoutes()}
          </Route>
        </Route>
      </Router>
    ),
    root
  )
}
