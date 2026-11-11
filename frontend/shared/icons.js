'use strict';

(function exposeIcons(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.SportBookingIcons = api;
    if (root.document) {
      const renderAll = () => api.renderAll(root.document);
      if (root.document.readyState === 'loading') {
        root.document.addEventListener('DOMContentLoaded', renderAll, { once: true });
      } else {
        renderAll();
      }
    }
  }
}(typeof window === 'undefined' ? null : window, () => {
  const paths = {
    back: 'M20 12H4m0 0 7-7m-7 7 7 7',
    forward: 'M4 12h16m0 0-7-7m7 7-7 7',
    check: 'm5 12 4 4L19 6',
    checkCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-5-10 3 3 7-7',
    close: 'M18 6 6 18M6 6l12 12',
    chevronRight: 'm9 18 6-6-6-6',
    chevronDown: 'm6 9 6 6 6-6',
    calendar: 'M4 5h16v16H4zM8 3v4m8-4v4M4 10h16',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-16v6l4 2',
    person: 'M20 21a8 8 0 0 0-16 0m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    group: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6-7a4 4 0 0 1 0 8m2 3h2a4 4 0 0 1 4 4v2',
    location: 'M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
    pinDrop: 'M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
    building: 'M3 21h18M5 21V7l7-4 7 4v14M9 10h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1',
    receipt: 'M6 2h12v20l-3-2-3 2-3-2-3 2V2Zm3 6h6m-6 4h6m-6 4h4',
    copy: 'M8 8V3h13v13h-5M3 8h13v13H3z',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14h.01M11 12h1v5h1',
    verified: 'm12 2 3 2 4-.2.8 3.8 2.2 3-2.2 3 .2 4-4-.2-3 2.2-3-2.2-3 .2-.8-3.8L2 12l2.2-3L4 5.2 8 5l4-3Zm-4 10 3 3 5-6',
    shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-4-11 3 3 5-6',
    search: 'm21 21-4.3-4.3M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z',
    map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15',
    navigation: 'm3 3 18 9-8 2-2 7L3 3Z',
    phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.7L7.1 10a16 16 0 0 0 6 6l1.6-1.9a2 2 0 0 1 1.7-.6l3 .5a2 2 0 0 1 1.6 1.9Z',
    mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
    download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
    upload: 'M12 16V4m-5 5 5-5 5 5M5 14v6h14v-6',
    printer: 'M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2m-10-3h10v7H7z',
    share: 'M12 16V4m-5 5 5-5 5 5M5 14v6h14v-6',
    ticket: 'M3 7a2 2 0 0 0 0 4v2a2 2 0 0 0 0 4v3h18v-3a2 2 0 0 1 0-4v-2a2 2 0 0 1 0-4V4H3v3Zm9-3v2m0 3v2m0 3v2m0 3v2',
    ball: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-4-9 4-3 4 3-2 5h-4l-2-5Zm4-3V2m4 11 5-2m-11 2-5-2m9 7 3 4m-8-4-3 4',
    field: 'M3 4h18v16H3zM12 4v16m0-10a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM3 9h4v6H3m18-6h-4v6h4',
    refresh: 'M20 7v5h-5M4 17v-5h5m-4-3a8 8 0 0 1 13-3l2 1m-16 10-2 1a8 8 0 0 0 13 3',
    sync: 'M20 7v5h-5M4 17v-5h5m-4-3a8 8 0 0 1 13-3l2 1m-16 10-2 1a8 8 0 0 0 13 3',
    lock: 'M5 11h14v11H5zM8 11V7a4 4 0 0 1 8 0v4',
    money: 'M3 6h18v13H3zM3 10h18m-9 3h.01M7 3h14',
    wallet: 'M3 5h18v15H3zM3 8h18m-5 5h2',
    card: 'M2 5h20v14H2zM2 10h20',
    timer: 'M12 8v5l3 2m4-8 2-2m-9-3V2m-7 1 2 2m15 7a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    star: 'm12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3-6.2 3.3 1.2-6.8-5-4.9 6.9-1L12 2Z',
    heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
    bolt: 'm13 2-3 9h7L8 22l3-9H4l9-11Z',
    pause: 'M8 5h3v14H8zm5 0h3v14h-3z',
    radar: 'M12 12 4 4m8 8 9-3m-9 3 1 9m9-9a10 10 0 1 1-10-10',
    sensor: 'M12 12a2 2 0 1 0 0 .01ZM5 5a10 10 0 0 0 0 14m14 0a10 10 0 0 0 0-14M8 8a6 6 0 0 0 0 8m8 0a6 6 0 0 0 0-8',
    expand: 'm7 10 5 5 5-5',
    collapse: 'm7 14 5-5 5 5',
    edit: 'm12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z',
    trash: 'M3 6h18m-2 0-1 15H6L5 6m4 0V3h6v3m-5 4v7m4-7v7',
    login: 'M10 17l5-5-5-5m5 5H3m9-9h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7',
    logout: 'm14 17 5-5-5-5m5 5H7m5 4v3H5V4h7v3',
    notification: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4',
    chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z',
    groupPeople: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6-5h4m-2-2v4',
    award: 'm12 15 3.5 7 1-4 4-1-7-3.5M12 15l-3.5 7-1-4-4-1 7-3.5M18 8A6 6 0 1 1 6 8a6 6 0 0 1 12 0Z',
    rule: 'M9 12l2 2 4-4M5 3h14v18H5zM8 7h8m-8 10h8',
    sentiment: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM8 14s1.5 3 4 3 4-3 4-3m-7-5h.01M15 9h.01',
    bathroom: 'M3 12h18l-2 9H5l-2-9Zm4 0V5a3 3 0 0 1 6 0v1m4 6V7a3 3 0 0 1 6 0v5',
    gender: 'M9 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm3.5-8.5L19 0m-5 0h5v5M9 15v7m-3-3h6',
    shuffle: 'm18 14 4 4-4 4m0-16 4 4-4 4M2 18h2a5 5 0 0 0 4-2l8-8a5 5 0 0 1 4-2h2M2 6h2a5 5 0 0 1 4 2l1 1m4 6 3 3a5 5 0 0 0 4 2h2',
    speed: 'M12 14l4-4m-4-8a10 10 0 1 0 10 10h-3a7 7 0 1 1-7-7V2Zm0 0v5m10 5h-5',
    tune: 'M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M2 14h4m4-6h4m4 6h4',
    visibility: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    visibilityOff: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a14 14 0 0 1-3.2 4.1M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7a10 10 0 0 0 4-.8',
    qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zm5 0h2m-7 5h3m2-2v4',
    replay: 'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5',
    venue: 'M3 21h18M5 21V5h14v16M9 9h2m2 0h2m-6 4h2m2 0h2m-6 4h2m2 0h2M8 5V2h8v3',
    hourglass: 'M6 2h12M6 22h12M7 2c0 5 5 5 5 10s-5 5-5 10m10-20c0 5-5 5-5 10s5 5 5 10',
    account: 'M3 4h18v16H3zM7 9a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm-1 7a3 3 0 0 1 6 0m3-6h3m-3 4h3',
    circle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
    unknown: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-2.5-11a2.5 2.5 0 1 1 4.2 1.8c-1 .9-1.7 1.2-1.7 2.7m0 3h.01',
    emailPhone: 'M3 5h18v14H3zM3 6l9 7 9-7m-9 1v12'
  };

  const aliases = {
    arrow_back: 'back', arrow_forward: 'forward', check: 'check', check_circle: 'checkCircle',
    close: 'close', cancel: 'close', chevron_right: 'chevronRight', chevron_down: 'chevronDown',
    calendar_month: 'calendar', calendar_today: 'calendar', event: 'calendar', event_available: 'calendar',
    event_busy: 'calendar', schedule: 'clock', timer: 'timer', hourglass_top: 'hourglass',
    person: 'person', account_circle: 'person', male: 'person', female: 'person',
    group_add: 'groupPeople', groups: 'group', groups_3: 'groupPeople', local_convenience_store: 'building',
    stadium: 'venue', account_balance: 'building', account_balance_wallet: 'wallet',
    receipt: 'receipt', receipt_long: 'receipt', assignment_return: 'receipt', badge: 'verified', verified: 'verified',
    verified_user: 'shield', shield_lock: 'shield', shield: 'shield', content_copy: 'copy', info: 'info',
    location_on: 'location', pin_drop: 'pinDrop', map: 'map', navigation: 'navigation', near_me: 'navigation',
    directions: 'navigation', directions_walk: 'navigation', phone: 'phone', call: 'phone', phone_in_talk: 'phone', phone_iphone: 'phone',
    mail: 'mail', print: 'printer', file_download: 'download', share: 'share',
    qr_code_scanner: 'qr', sports: 'field', sports_soccer: 'ball', sports_cricket: 'ball',
    sports_tennis: 'ball', sync: 'sync', replay: 'replay', search: 'search',
    lock: 'lock', credit_card: 'card', payments: 'money', currency_exchange: 'money',
    delete: 'trash', delete_forever: 'trash', edit_note: 'edit', login: 'login', logout: 'logout',
    notifications: 'notification', notifications_active: 'notification', forum: 'chat', favorite_border: 'heart',
    military_tech: 'award', workspace_premium: 'award', rule: 'rule',
    sentiment_satisfied: 'sentiment', wc: 'bathroom', transgender: 'gender',
    shuffle: 'shuffle', speed: 'speed',     tune: 'tune', visibility: 'visibility', visibility_off: 'visibilityOff',
    radar: 'radar', sensors: 'sensor', pause_circle: 'pause', star: 'star',
    bolt: 'bolt', radio_button_unchecked: 'circle', expand_less: 'collapse',
    expand_more: 'expand', gavel: 'rule', reviews: 'star', headset_mic: 'phone',
    open_in_new: 'forward', flash_on: 'bolt', grid_view: 'field', how_to_reg: 'checkCircle'
  };
  const names = new Set(Object.keys(aliases));

  function draw(element, name) {
    const pathName = Object.hasOwn(aliases, name) ? aliases[name] : null;
    const iconPath = pathName && paths[pathName] ? paths[pathName] : paths.unknown;
    if (!pathName || !paths[pathName]) console.warn(`Unknown SportBooking icon: ${name}`);
    element.replaceChildren();
    element.setAttribute('viewBox', '0 0 24 24');
    element.setAttribute('width', '1em');
    element.setAttribute('height', '1em');
    element.setAttribute('fill', 'none');
    element.setAttribute('stroke', 'currentColor');
    element.setAttribute('stroke-width', '2');
    element.setAttribute('stroke-linecap', 'round');
    element.setAttribute('stroke-linejoin', 'round');
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('focusable', 'false');
    const path = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', iconPath);
    element.append(path);
    return element;
  }

  function setIcon(element, name) {
    if (!element || !element.ownerDocument) throw new TypeError('An SVG element is required.');
    element.setAttribute('data-sb-icon', name);
    return draw(element, name);
  }

  function createIcon(name, className = '') {
    const element = globalThis.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (className) element.setAttribute('class', className);
    return setIcon(element, name);
  }

  function renderAll(root) {
    root.querySelectorAll('svg[data-sb-icon]').forEach((element) => {
      draw(element, element.getAttribute('data-sb-icon'));
    });
  }

  return { names, setIcon, createIcon, renderAll };
}));
