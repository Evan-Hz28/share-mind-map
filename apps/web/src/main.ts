import "element-plus/dist/index.css";
import "mind-elixir/style.css";
import "./app/app.css";

import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import { createAppRouter } from "./router.js";

const pinia = createPinia();
const router = createAppRouter({ pinia });

createApp(App).use(pinia).use(router).mount("#app");
