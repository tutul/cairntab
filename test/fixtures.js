// Bookmark trees with the quirks real profiles have: imported category folders next to the Pin
// root, Chinese titles, a bookmarklet, nested folders inside a task, a loose URL in Groups, a folder
// that belongs to no role, and role folders typed in the wrong case. All sites are public examples.

export const NOW = Date.UTC(2026, 10, 4, 4, 0, 0); // 2026-11-04 12:00 UTC+8
export const DAY = 24 * 60 * 60 * 1000;

export function sampleTree({ archiveFolder = true, inboxFolder = true } = {}) {
  const pinChildren = [
    {
      title: "Top",
      children: [
        { title: "Gmail", url: "https://mail.google.com/mail/u/0/#inbox" },
        { title: "Google Calendar", url: "https://calendar.google.com/calendar/u/0/r" },
        { title: "GitHub", url: "https://github.com/" },
        { title: "ChatGPT", url: "https://chatgpt.com/" },
        { title: "", url: "https://www.notion.so/" },
        { title: "點餅乾", url: "javascript:Game.ClickCookie();" },
      ],
    },
    {
      title: "Groups",
      children: [
        {
          title: "Weekly 週報",
          children: [
            { title: "Dune dashboard", url: "https://dune.com/example/weekly" },
            { title: "Linear", url: "https://linear.app/acme/team/ENG/active" },
          ],
        },
        {
          title: "crypto 研究",
          children: [
            { title: "DefiLlama", url: "https://defillama.com/" },
            { title: "子資料夾", children: [{ title: "Etherscan", url: "https://etherscan.io/" }] },
          ],
        },
        { title: "空任務", children: [] },
        { title: "隨手一個連結", url: "https://news.ycombinator.com/" },
      ],
    },
  ];
  if (inboxFolder) {
    pinChildren.push({
      title: "inbox", // lower-case on purpose: the user types folder names by hand
      children: [
        { title: "Old article", url: "https://example.com/old", dateAdded: NOW - 40 * DAY },
        { title: "Almost due", url: "https://example.com/almost", dateAdded: NOW - 28 * DAY },
        { title: "Fresh", url: "https://example.com/fresh", dateAdded: NOW - 1 * DAY },
      ],
    });
  }
  if (archiveFolder) pinChildren.push({ title: "Archive", children: [] });
  pinChildren.push({ title: "舊東西", children: [{ title: "x", url: "https://example.org/" }] });

  return {
    id: "0",
    title: "",
    children: [
      {
        title: "Bookmarks bar",
        folderType: "bookmarks-bar",
        children: [
          { title: "匯入的收藏", children: [{ title: "Common", children: [{ title: "Figma", url: "https://figma.com/" }] }] },
          { title: "開發", children: [{ title: "MDN", url: "https://developer.mozilla.org/" }] },
          { title: "Pin", children: pinChildren },
        ],
      },
      { title: "Other bookmarks", folderType: "other", children: [] },
      { title: "Mobile bookmarks", folderType: "mobile", children: [] },
    ],
  };
}
