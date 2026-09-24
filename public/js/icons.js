// Icônes SVG (trait) utilisées dans le site et l'admin.
window.ICONS = (() => {
  const s = (d, vb = '0 0 24 24') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  return {
    menu: s('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    close: s('<path d="M6 6l12 12M18 6L6 18"/>'),
    search: s('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
    user: s('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
    cart: s('<path d="M3 4h2l2.4 11.2a2 2 0 002 1.6h7.7a2 2 0 002-1.5L21 8H6.2"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>'),
    cartPlus: s('<path d="M3 4h2l2.4 11.2a2 2 0 002 1.6h7.7a2 2 0 002-1.5L21 8H6.2"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/><path d="M13 9v5M10.5 11.5h5"/>'),
    truck: s('<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
    shield: s('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
    tag: s('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>'),
    cash: s('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 10v4M18 10v4"/>'),
    phone: s('<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>'),
    whatsapp: '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 3C9 3 3.3 8.6 3.3 15.6c0 2.5.7 4.8 2 6.8L3 29l6.8-2.2c1.9 1.1 4 1.6 6.2 1.6 7 0 12.7-5.7 12.7-12.7S23 3 16 3zm0 23.2c-2 0-3.9-.5-5.5-1.5l-.4-.2-4 1.3 1.3-3.9-.3-.4a10.4 10.4 0 01-1.6-5.6C5.5 9.9 10.2 5.3 16 5.3S26.5 9.9 26.5 15.6 21.8 26.2 16 26.2zm5.8-7.8c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.2-.2-.3 0-.5.1-.7l.5-.6.3-.5c.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.2 1.4 3.5c.2.2 2.4 3.6 5.7 5 .8.3 1.4.5 1.9.7.8.3 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5-.1-.2-.3-.3-.6-.4z"/></svg>',
    trash: s('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
    chevron: s('<path d="M9 6l6 6-6 6"/>'),
    box: s('<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>'),
    logout: s('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>'),
    edit: s('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
    plus: s('<path d="M12 5v14M5 12h14"/>'),
    dashboard: s('<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>'),
    users: s('<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5"/><circle cx="17" cy="7" r="2.5"/><path d="M17 13c2.5 0 5 1.3 5 4"/>'),
    settings: s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
    inbox: s('<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>'),
    store: s('<path d="M3 9l2-5h14l2 5M3 9v11h18V9M3 9h18"/><path d="M9 20v-6h6v6"/>'),
    // Icônes des catégories de pièces
    cat: {
      screen: s('<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M9 7l3 4-2 2 4 4"/>'),
      battery: s('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M10 2h4M13 8l-3 5h4l-3 5"/>'),
      body: s('<rect x="6" y="2" width="12" height="20" rx="2.5"/><circle cx="10" cy="6.5" r="1.6"/><circle cx="10" cy="10.5" r="1.6"/>'),
      camera: s('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 4l3 6M20 12l-6 3M12 20l-3-6M4 12l6-3"/>'),
      chip: s('<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M9 3v4M12 3v4M15 3v4M9 17v4M12 17v4M15 17v4M3 9h4M3 12h4M3 15h4M17 9h4M17 12h4M17 15h4"/>'),
      plug: s('<path d="M4 16h8v4H4zM6 16v-4l6-6h8M8 12h4"/><rect x="14" y="4" width="6" height="4" rx="1"/>'),
      speaker: s('<rect x="4" y="7" width="16" height="10" rx="2"/><circle cx="9" cy="12" r="2.5"/><path d="M14 10h3M14 14h3"/>'),
      screw: s('<path d="M14 4l6 6-3 3-6-6zM11 7l-7 7 3 3 7-7M6 16l-2 4 4-2"/>'),
      flex: s('<path d="M4 4h6v5H4zM14 15h6v5h-6zM7 9v4c0 2 1 3 3 3h4"/>'),
      glass: s('<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M9 6l6 6M9 11l6 6"/>'),
      tools: s('<path d="M14.7 6.3a4 4 0 00-5.4 5.1L3 17.7 6.3 21l6.3-6.3a4 4 0 005.1-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>'),
      box: s('<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>'),
    },
  };
})();
