'use strict';

(() => {
  const form = document.getElementById('topSearchForm');
  const results = document.getElementById('venuesListContainer');
  const paginationButtons = document.getElementById('paginationButtons');
  const sportInput = document.getElementById('paramSport');
  const queryInput = document.getElementById('queryInput');
  const districtInput = document.getElementById('paramDistrict');
  const dateInput = document.getElementById('paramDate');
  const timeBandSelect = document.getElementById('timeSlotSelect');
  const slotCheckboxes = [...document.querySelectorAll('.filter-slot-check')];
  const countResults = document.getElementById('countResults');
  const paginationRange = document.getElementById('paginationRange');
  const totalCountText = document.getElementById('totalCountText');
  const allowedSports = new Set(['BADMINTON', 'FOOTBALL_MINI', 'PICKLEBALL']);
  const searchFilters = window.SportBookingSearchFilters;
  const pageSize = 10;

  if (!form || !results) return;
  if (!searchFilters) throw new Error('Thiếu cấu hình bộ lọc tìm sân.');

  const filterState = { date: '', timeBands: [] };

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function safeUrl(value) {
    if (typeof value !== 'string' || value.trim() === '') return null;
    try {
      const url = new URL(value, window.location.origin);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function currentFilters() {
    return {
      sport: sportInput.value,
      district: districtInput.value.trim(),
      q: queryInput.value.trim(),
      date: filterState.date,
      time_band: filterState.timeBands.join(',')
    };
  }

  function detailUrl(facility) {
    const returnTo = window.location.pathname === '/tim-san.html'
      ? `${window.location.pathname}${window.location.search}${window.location.hash}`
      : '/tim-san.html';
    const params = new URLSearchParams({
      id: String(facility.id),
      returnTo
    });
    if (filterState.date) params.set('date', filterState.date);
    return `/chi-tiet-san.html?${params}`;
  }

  function updateUrl(page, historyMode) {
    const params = searchFilters.buildSearchParams({
      ...currentFilters(),
      timeBands: filterState.timeBands
    }, page);
    const url = `${window.location.pathname}?${params}`;
    if (historyMode === 'push') {
      window.history.pushState({}, '', url);
    } else if (historyMode === 'replace') {
      window.history.replaceState({}, '', url);
    }
  }

  function updateTimeBandControls() {
    filterState.timeBands = searchFilters.normalizeTimeBands(filterState.timeBands);
    slotCheckboxes.forEach((checkbox) => {
      checkbox.checked = filterState.timeBands.includes(checkbox.value);
    });

    const selectState = searchFilters.getTimeBandSelectState(filterState.timeBands);
    let multipleOption = timeBandSelect.querySelector('[data-multiple-time-bands]');
    if (selectState.label) {
      if (!multipleOption) {
        multipleOption = document.createElement('option');
        multipleOption.value = '__multiple__';
        multipleOption.disabled = true;
        multipleOption.dataset.multipleTimeBands = '';
        timeBandSelect.prepend(multipleOption);
      }
      multipleOption.textContent = selectState.label;
    } else if (multipleOption) {
      multipleOption.remove();
    }
    timeBandSelect.value = selectState.value;
  }

  function restoreFromUrl() {
    const filters = searchFilters.parseSearchState(window.location.search);
    sportInput.value = allowedSports.has(filters.sport) ? filters.sport : '';
    queryInput.value = filters.q;
    districtInput.value = filters.district;
    filterState.date = filters.date;
    dateInput.value = filters.date;
    filterState.timeBands = filters.timeBands;
    updateSelectedSport();
    updateTimeBandControls();
    return filters.page;
  }

  function showEmptyResults() {
    results.replaceChildren();
    const state = makeElement(
      'div',
      'col-span-full py-16 text-center text-on-surface-variant flex flex-col items-center justify-center gap-3'
    );
    state.setAttribute('role', 'status');
    state.append(makeElement(
      'span',
      'font-medium text-base',
      'Không có cụm sân nào phù hợp. Hãy thử đổi ngày, khung giờ hoặc bỏ bớt bộ lọc.'
    ));
    const resetButton = makeElement(
      'button',
      'mt-2 px-4 py-2 bg-primary text-on-primary rounded-xl font-bold text-sm cursor-pointer',
      'Đặt lại bộ lọc'
    );
    resetButton.type = 'button';
    resetButton.addEventListener('click', () => document.getElementById('clearFiltersBtn').click());
    state.append(resetButton);
    results.append(state);
  }

  function updateSelectedSport() {
    const currentSport = sportInput.value;
    document.querySelectorAll('.sport-tab-btn').forEach((button) => {
      const selected = button.dataset.sport === (currentSport || 'all');
      button.classList.toggle('bg-primary', selected);
      button.classList.toggle('text-on-primary', selected);
      button.classList.toggle('font-bold', selected);
      button.classList.toggle('shadow-sm', selected);
      button.classList.toggle('bg-surface-container', !selected);
      button.classList.toggle('text-on-surface', !selected);
      button.classList.toggle('font-medium', !selected);
    });
    document.querySelectorAll('.filter-sport-check').forEach((checkbox) => {
      checkbox.checked = checkbox.value === currentSport;
    });
  }

  function showState(message, isError = false, retry = false) {
    results.replaceChildren();
    const state = makeElement(
      'div',
      'col-span-full py-16 text-center text-on-surface-variant flex flex-col items-center justify-center gap-3'
    );
    state.setAttribute('role', isError ? 'alert' : 'status');
    if (!isError) {
      state.append(window.SportBookingIcons.createIcon('sync', 'text-4xl'));
    }
    state.append(makeElement('span', 'font-medium text-base', message));
    if (retry) {
      const button = makeElement('button', 'mt-2 px-4 py-2 bg-primary text-on-primary rounded-xl font-bold text-sm cursor-pointer', 'Thử lại');
      button.type = 'button';
      button.addEventListener('click', () => load(currentPage, { historyMode: 'none' }));
      state.append(button);
    }
    results.append(state);
  }

  function addDetailLine(parent, icon, text) {
    if (!text) return;
    const line = makeElement('p', 'text-sm text-on-surface-variant flex items-center gap-1 mt-1.5');
    line.append(window.SportBookingIcons.createIcon(icon, 'text-primary text-[16px] shrink-0'));
    line.append(makeElement('span', 'truncate', text));
    parent.append(line);
  }

  function createFacilityCard(facility) {
    const inactive = facility.is_active === false
      || (Number.isFinite(Number(facility.active_court_count))
        && Number(facility.active_court_count) === 0);
    const article = makeElement(
      'article',
      `bg-surface-container-lowest rounded-2xl shadow-sm hover:shadow-md transition-all p-5 flex flex-col md:flex-row gap-5 border border-gray-100 group${inactive ? ' opacity-70' : ''}`
    );
    const href = detailUrl(facility);
    article.setAttribute('role', 'link');
    article.tabIndex = 0;
    article.addEventListener('click', (event) => {
      if (!event.target.closest('a, button')) window.location.assign(href);
    });
    article.addEventListener('keydown', (event) => {
      if (event.target === article && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        window.location.assign(href);
      }
    });
    const imageWrap = makeElement('div', 'relative md:w-64 h-52 rounded-xl overflow-hidden shrink-0 bg-surface-container flex items-center justify-center');
    const imageUrl = safeUrl(facility.image_url || '');
    if (imageUrl) {
      const image = makeElement('img', 'w-full h-full object-cover group-hover:scale-105 transition-transform duration-300');
      image.src = imageUrl;
      image.alt = facility.name || '';
      imageWrap.append(image);
    } else {
      imageWrap.append(window.SportBookingIcons.createIcon('stadium', 'text-4xl text-primary'));
    }
    const sportBadge = makeElement('span', 'absolute bottom-2.5 left-2.5 px-2.5 py-0.5 rounded-full bg-primary text-on-primary text-xs font-bold shadow-sm', facility.sport_name || '');
    imageWrap.append(sportBadge);
    if (inactive) {
      imageWrap.append(makeElement(
        'span',
        'absolute top-2.5 left-2.5 px-2.5 py-1 rounded-full bg-surface text-error text-xs font-bold shadow-sm',
        'Tạm ngưng hoạt động'
      ));
    }
    article.append(imageWrap);

    const content = makeElement('div', 'flex-1 flex flex-col justify-between');
    const main = makeElement('div');
    const titleRow = makeElement('div', 'flex items-start justify-between gap-2');
    titleRow.append(makeElement('h3', 'font-bold text-lg text-on-surface leading-tight', facility.name || ''));
    if (facility.district) {
      titleRow.append(makeElement('span', 'px-2.5 py-0.5 bg-surface-container text-xs font-semibold rounded-md text-on-surface-variant shrink-0', facility.district));
    }
    main.append(titleRow);

    addDetailLine(main, 'pin_drop', facility.address || '');
    const contactParts = [];
    if (facility.hotline) contactParts.push(`Liên hệ: ${facility.hotline}`);
    if (facility.opening_time || facility.closing_time) {
      contactParts.push(window.SportBookingFormat.formatOpeningHours(
        facility.opening_time,
        facility.closing_time
      ));
    }
    if (contactParts.length) addDetailLine(main, 'schedule', contactParts.join(' · '));

    const amenities = Array.isArray(facility.amenities) ? facility.amenities.slice(0, 3) : [];
    if (amenities.length) {
      const tags = makeElement('div', 'flex flex-wrap items-center gap-1.5 mt-3');
      amenities.forEach((amenity) => {
        tags.append(makeElement('span', 'px-2 py-0.5 rounded-lg bg-surface-container text-xs text-on-surface-variant font-medium', `✓ ${amenity}`));
      });
      main.append(tags);
    }
    content.append(main);

    const actions = makeElement('div', 'flex items-center justify-between gap-3 pt-4 border-t mt-4');
    const price = makeElement('div');
    price.append(makeElement('span', 'text-xs text-gray-500', 'Giá thường từ:'));
    if (facility.price_min !== null && facility.price_min !== undefined) {
      const priceValue = makeElement('div', 'font-bold text-primary text-lg', `${Number(facility.price_min).toLocaleString('vi-VN')} đ`);
      priceValue.append(makeElement('span', 'text-xs font-normal text-gray-500', ' /h'));
      price.append(priceValue);
    }
    const rating = window.SportBookingFormat.formatFacilityRating(facility.rating);
    if (rating !== null) {
      price.append(makeElement('span', 'text-xs text-amber-600', `★ ${rating}`));
    }
    actions.append(price);

    const buttons = makeElement('div', 'flex items-center gap-2');
    const mapLink = makeElement('a', 'px-3.5 py-2.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold text-xs flex items-center gap-1 transition-all shadow-sm', 'Xem trên bản đồ');
    const suppliedMapUrl = typeof facility.map_url === 'string' ? facility.map_url.trim() : '';
    let mapUrl = '';
    let mapNote = '';
    if (suppliedMapUrl.startsWith('https://')) {
      try {
        const parsedMapUrl = new URL(suppliedMapUrl);
        if (parsedMapUrl.protocol === 'https:') mapUrl = parsedMapUrl.href;
      } catch {}
    }
    if (!mapUrl && facility.latitude !== null && facility.latitude !== undefined
        && facility.longitude !== null && facility.longitude !== undefined
        && Number.isFinite(Number(facility.latitude)) && Number.isFinite(Number(facility.longitude))) {
      mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${facility.latitude},${facility.longitude}`)}`;
      mapNote = 'Theo tọa độ';
    } else if (!mapUrl && typeof facility.address === 'string' && facility.address.trim()) {
      mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(facility.address.trim())}`;
      mapNote = 'Theo địa chỉ';
    }
    mapLink.href = mapUrl || '#';
    if (mapUrl) {
      mapLink.target = '_blank';
      mapLink.rel = 'noopener noreferrer';
    } else {
      mapLink.hidden = true;
    }
    if (mapNote) {
      const mapNoteEl = makeElement('span', 'text-[10px] text-gray-500', mapNote);
      buttons.append(mapNoteEl);
    }
    buttons.append(mapLink);
    if (inactive) {
      const bookButton = makeElement(
        'button',
        'px-5 py-2.5 rounded-xl bg-surface-container text-on-surface-variant font-bold text-sm shadow-sm flex items-center gap-1 cursor-not-allowed',
        'Đặt sân ngay'
      );
      bookButton.type = 'button';
      bookButton.disabled = true;
      bookButton.title = 'Cơ sở tạm ngưng hoạt động';
      buttons.append(bookButton);
      buttons.append(makeElement('span', 'text-xs text-error', 'Cơ sở tạm ngưng hoạt động'));
    } else {
      const bookLink = makeElement('a', 'px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-container text-white font-bold text-sm shadow-sm transition-all flex items-center gap-1', 'Đặt sân ngay');
      bookLink.href = href;
      buttons.append(bookLink);
    }
    actions.append(buttons);
    content.append(actions);
    article.append(content);
    return article;
  }

  function renderPagination(pagination) {
    paginationButtons.replaceChildren();
    const page = pagination.page;
    const totalPages = pagination.total_pages;
    if (!totalPages) return;

    function addPageButton(label, target, active = false, disabled = false) {
      const button = makeElement(
        'button',
        active
          ? 'w-9 h-9 rounded-xl bg-primary text-white font-bold shadow-sm'
          : 'w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors cursor-pointer',
        label
      );
      button.type = 'button';
      button.disabled = disabled;
      if (!active && !disabled) {
        button.addEventListener('click', () => load(target, { historyMode: 'push' }));
      }
      paginationButtons.append(button);
    }

    addPageButton('‹', page - 1, false, page <= 1);
    for (let target = 1; target <= totalPages; target += 1) {
      addPageButton(String(target), target, target === page);
    }
    addPageButton('Tiếp ›', page + 1, false, page >= totalPages);
  }

  let currentPage = 1;
  let filterDebounce;
  let loadSequence = 0;
  async function load(page, { historyMode = 'push' } = {}) {
    const sequence = ++loadSequence;
    currentPage = page;
    updateUrl(page, historyMode);
    countResults.textContent = '…';
    totalCountText.textContent = '…';
    paginationRange.textContent = '—';
    showState('Đang tải danh sách sân từ cơ sở dữ liệu...');
    try {
      const response = await window.SportBookingFacilities.list({
        ...currentFilters(),
        page,
        page_size: pageSize
      });
      if (!response || sequence !== loadSequence) return;

      const facilities = response.facilities;
      const pagination = response.pagination;
      const lastPage = Math.max(pagination.total_pages, 1);
      if (page > lastPage) {
        return load(lastPage, { historyMode: 'replace' });
      }
      countResults.textContent = String(pagination.total);
      totalCountText.textContent = String(pagination.total);
      const start = facilities.length ? (page - 1) * pagination.page_size + 1 : 0;
      const end = facilities.length ? start + facilities.length - 1 : 0;
      paginationRange.textContent = `${start} - ${end}`;

      if (facilities.length === 0) {
        showEmptyResults();
        renderPagination(pagination);
        return;
      }

      results.replaceChildren(...facilities.map(createFacilityCard));
      renderPagination(pagination);
    } catch (error) {
      if (sequence !== loadSequence) return;
      countResults.textContent = '—';
      totalCountText.textContent = '—';
      paginationRange.textContent = '—';
      showState(error.message || 'Không thể tải danh sách sân. Vui lòng thử lại.', true, true);
      paginationButtons.replaceChildren();
    }
  }

  function setSport(value) {
    window.clearTimeout(filterDebounce);
    sportInput.value = allowedSports.has(value) ? value : '';
    updateSelectedSport();
    load(1, { historyMode: 'push' });
  }

  const dateRange = searchFilters.getDateRange();
  dateInput.min = dateRange.min;
  dateInput.max = dateRange.max;
  const initialPage = restoreFromUrl();
  updateSelectedSport();

  document.querySelectorAll('.sport-tab-btn').forEach((button) => {
    button.addEventListener('click', () => setSport(button.dataset.sport));
  });
  document.querySelectorAll('.filter-sport-check').forEach((checkbox) => {
    checkbox.addEventListener('change', () => setSport(checkbox.checked ? checkbox.value : ''));
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    window.clearTimeout(filterDebounce);
    filterState.date = dateInput.value;
    load(1, { historyMode: 'push' });
  });
  dateInput.addEventListener('change', () => {
    filterState.date = dateInput.value;
  });
  timeBandSelect.addEventListener('change', () => {
    if (timeBandSelect.value === '__multiple__') return;
    filterState.timeBands = searchFilters.normalizeTimeBands([timeBandSelect.value]);
    updateTimeBandControls();
  });
  slotCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      filterState.timeBands = slotCheckboxes
        .filter((item) => item.checked)
        .map((item) => item.value);
      updateTimeBandControls();
      window.clearTimeout(filterDebounce);
      filterDebounce = window.setTimeout(
        () => load(1, { historyMode: 'push' }),
        250
      );
    });
  });
  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    window.clearTimeout(filterDebounce);
    sportInput.value = '';
    queryInput.value = '';
    districtInput.value = '';
    filterState.date = '';
    filterState.timeBands = [];
    dateInput.value = '';
    updateTimeBandControls();
    updateSelectedSport();
    load(1, { historyMode: 'push' });
  });

  window.addEventListener('popstate', () => {
    window.clearTimeout(filterDebounce);
    const page = restoreFromUrl();
    load(page, { historyMode: 'none' });
  });

  load(initialPage, { historyMode: 'none' });
})();
