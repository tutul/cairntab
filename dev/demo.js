// Demo data for screenshots and trying the page (dev/preview.html?demo). Every site is public and
// every title made up; nothing here comes from a real profile. Dates are relative to "now" so the
// Inbox countdowns look the same whenever the screenshots are retaken.

const DAY = 24 * 60 * 60 * 1000;

export function demoTree(now = Date.now()) {
  const ago = (d) => now - d * DAY;
  return {
    id: "0",
    title: "",
    children: [
      {
        title: "Bookmarks bar",
        folderType: "bookmarks-bar",
        children: [
          { title: "Reading", children: [
            { title: "MDN Web Docs", url: "https://developer.mozilla.org/" },
            { title: "Hacker News", url: "https://news.ycombinator.com/" },
          ] },
          { title: "CairnTab", children: [
            { title: "Top", children: [
              { title: "GitHub", url: "https://github.com/" },
              { title: "Calendar", url: "https://calendar.google.com/" },
              { title: "Figma", url: "https://www.figma.com/" },
              { title: "Notion", url: "https://www.notion.so/" },
              { title: "YouTube", url: "https://www.youtube.com/" },
              { title: "Wikipedia", url: "https://www.wikipedia.org/" },
              { title: "Maps", url: "https://www.google.com/maps" },
            ] },
            { title: "Groups", children: [
              { title: "Side project", children: [
                { title: "Repository", url: "https://github.com/example/side-project" },
                { title: "Chrome extension docs", url: "https://developer.chrome.com/docs/extensions" },
                { title: "web.dev: Learn CSS", url: "https://web.dev/learn/css" },
              ] },
              { title: "京都旅行", children: [
                { title: "京都市交通局", url: "https://www.city.kyoto.lg.jp/kotsu/" },
                { title: "Kyoto weather", url: "https://www.jma.go.jp/bosai/forecast/" },
                { title: "Wikivoyage: Kyoto", url: "https://en.wikivoyage.org/wiki/Kyoto" },
              ] },
              { title: "讀書會", children: [
                { title: "Project Gutenberg", url: "https://www.gutenberg.org/" },
                { title: "Open Library", url: "https://openlibrary.org/" },
              ] },
            ] },
            { title: "Inbox", children: [
              { title: "A talk to watch this weekend", url: "https://www.youtube.com/watch?v=demo", dateAdded: ago(27) },
              { title: "Long read: how browsers paint", url: "https://developer.chrome.com/blog/inside-browser-part3", dateAdded: ago(12) },
              { title: "Recipe: miso soup", url: "https://en.wikibooks.org/wiki/Cookbook:Miso_Soup", dateAdded: ago(4) },
              { title: "Typography for the web", url: "https://web.dev/learn/design/typography", dateAdded: ago(1) },
            ] },
            { title: "Archive", children: [
              { title: "Conference schedule", url: "https://example.com/schedule", dateAdded: ago(60) },
              { title: "Old release notes", url: "https://example.com/release-notes", dateAdded: ago(90) },
            ] },
          ] },
        ],
      },
      { title: "Other bookmarks", folderType: "other", children: [] },
    ],
  };
}

export const demoTabs = [
  { id: 1, url: "fake-extension://fake/newtab.html", active: true },
  { id: 2, url: "https://github.com/", title: "GitHub" },
  { id: 3, url: "https://github.com/example/side-project", title: "example/side-project", groupId: 900 },
  { id: 4, url: "https://developer.chrome.com/docs/extensions", title: "Chrome extension docs", groupId: 900 },
  { id: 5, url: "https://en.wikipedia.org/wiki/Cairn", title: "Cairn - Wikipedia" },
  { id: 6, url: "https://www.youtube.com/watch?v=lofi", title: "Music to focus to" },
];
export const demoGroups = [{ id: 900, windowId: 1, title: "Side project", color: "blue" }];
