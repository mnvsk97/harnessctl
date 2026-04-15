import { defineConfig } from "vitepress";

export default defineConfig({
  title: "harnessctl",
  description: "Universal CLI for coding agents",
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "GitHub", link: "https://github.com/mnvsk97/harnessctl" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Usage", link: "/guide/usage" },
          { text: "Configuration", link: "/guide/configuration" },
          { text: "Adapters", link: "/guide/adapters" },
          { text: "Observability", link: "/guide/observability" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/mnvsk97/harnessctl" },
    ],
  },
});
