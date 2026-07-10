import { render } from "solid-js/web"
import App from "./chat-app/App"
import { setupEmulator } from "./emulator"
import "@kilocode/kilo-ui/styles"

const root = document.getElementById("root")

if (root) {
  // Initialize the VS Code Extension Host API Emulator
  setupEmulator()
  render(() => <App />, root)
}
