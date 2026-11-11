'use strict';

(function exposeBookingDetailState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingDetailState = api;
}(typeof window === 'undefined' ? null : window, () => {
  const sportIcons = Object.freeze({
    FOOTBALL_MINI: 'sports_soccer',
    BADMINTON: 'sports',
    PICKLEBALL: 'sports'
  });

  function getVenueImagePresentation(imageUrl, sportType) {
    if (typeof imageUrl === 'string' && imageUrl.trim()) {
      return { useImage: true, icon: null };
    }
    return {
      useImage: false,
      icon: sportIcons[String(sportType || '').toUpperCase()] || 'sports'
    };
  }

  return { getVenueImagePresentation };
}));
