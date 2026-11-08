'use strict';

(() => {
  const form = document.getElementById('topSearchForm');
  const results = document.getElementById('venuesListContainer');
  const paginationButtons = document.getElementById('paginationButtons');
  const sportInput = document.getElementById('paramSport');
  const queryInput = document.getElementById('queryInput');
  const districtInput = document.getElementById('paramDistrict');
  const countResults = document.getElementById('countResults');
  const paginationRange = document.getElementById('paginationRange');
  const totalCountText = document.getElementById('totalCountText');
  const allowedSports = new Set(['BADMINTON', 'FOOTBALL_MINI', 'PICKLEBALL']);
  const pageSize = 10;

  if (!form || !results) return;

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
      q: queryInput.value.trim()
    };
  }

  function updateUrl(page) {
    const params = new URLSearchParams();
    const filters = currentFilters();
    if (filters.sport) params.set('sport', filters.sport);
    if (filters.district) params.set('district', filters.district);
    if (filters.q) params.set('q', filters.q);
    params.set('page', String(page));
    window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
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
      state.append(makeElement('span', 'material-symbols-outlined text-4xl', 'sync'));
    }
    state.append(makeElement('span', 'font-medium text-base', message));
    if (retry) {
      const button = makeElement('button', 'mt-2 px-4 py-2 bg-primary text-on-primary rounded-xl font-bold text-sm cursor-pointer', 'Thử lại');
      button.type = 'button';
      button.addEventListener('click', () => load(currentPage));
      state.append(button);
    }
    results.append(state);
  }

  function addDetailLine(parent, icon, text) {
    if (!text) return;
    const line = makeElement('p', 'text-sm text-on-surface-variant flex items-center gap-1 mt-1.5');
    line.append(makeElement('span', 'material-symbols-outlined text-primary text-[16px] shrink-0', icon));
    line.append(makeElement('span', 'truncate', text));
    parent.append(line);
  }

  function createFacilityCard(facility) {
    const article = makeElement(
      'article',
      'bg-surface-container-lowest rounded-2xl shadow-sm hover:shadow-md transition-all p-5 flex flex-col md:flex-row gap-5 border border-gray-100 group'
    );
    const imageWrap = makeElement('div', 'relative md:w-64 h-52 rounded-xl overflow-hidden shrink-0 bg-surface-container flex items-center justify-center');
    const imageUrl = safeUrl(facility.image_url || '');
    if (imageUrl) {
      const image = makeElement('img', 'w-full h-full object-cover group-hover:scale-105 transition-transform duration-300');
      image.src = imageUrl;
      image.alt = facility.name || '';
      imageWrap.append(image);
    } else {
      imageWrap.append(makeElement('span', 'material-symbols-outlined text-4xl text-primary', 'stadium'));
    }
    const sportBadge = makeElement('span', 'absolute bottom-2.5 left-2.5 px-2.5 py-0.5 rounded-full bg-primary text-on-primary text-xs font-bold shadow-sm', facility.sport_name || '');
    imageWrap.append(sportBadge);
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
      contactParts.push(`Mở cửa: ${facility.opening_time || ''} - ${facility.closing_time || ''}`);
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
    if (facility.rating !== null && facility.rating !== undefined) {
      price.append(makeElement('span', 'text-xs text-amber-600', `★ ${facility.rating}`));
    }
    actions.append(price);

    const buttons = makeElement('div', 'flex items-center gap-2');
    const mapLink = makeElement('a', 'px-3.5 py-2.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold text-xs flex items-center gap-1 transition-all shadow-sm', 'Bản đồ');
    const mapUrl = safeUrl(facility.map_url || '');
    mapLink.href = mapUrl || '#';
    if (mapUrl) {
      mapLink.target = '_blank';
      mapLink.rel = 'noopener noreferrer';
    }
    buttons.append(mapLink);
    const bookLink = makeElement('a', 'px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-container text-white font-bold text-sm shadow-sm transition-all flex items-center gap-1', 'Đặt sân ngay');
    bookLink.href = '#';
    buttons.append(bookLink);
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
      if (!active && !disabled) button.addEventListener('click', () => load(target));
      paginationButtons.append(button);
    }

    addPageButton('‹', page - 1, false, page <= 1);
    for (let target = 1; target <= totalPages; target += 1) {
      addPageButton(String(target), target, target === page);
    }
    addPageButton('Tiếp ›', page + 1, false, page >= totalPages);
  }

  let currentPage = 1;
  async function load(page) {
    currentPage = page;
    updateUrl(page);
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
      if (!response) return;

      const facilities = response.facilities;
      const pagination = response.pagination;
      const lastPage = Math.max(pagination.total_pages, 1);
      if (page > lastPage) {
        return load(lastPage);
      }
      countResults.textContent = String(pagination.total);
      totalCountText.textContent = String(pagination.total);
      const start = facilities.length ? (page - 1) * pagination.page_size + 1 : 0;
      const end = facilities.length ? start + facilities.length - 1 : 0;
      paginationRange.textContent = `${start} - ${end}`;

      if (facilities.length === 0) {
        showState('Không tìm thấy sân phù hợp. Hãy đổi từ khóa, môn hoặc quận, hoặc đặt lại bộ lọc.');
        renderPagination(pagination);
        return;
      }

      results.replaceChildren(...facilities.map(createFacilityCard));
      renderPagination(pagination);
    } catch (error) {
      countResults.textContent = '—';
      totalCountText.textContent = '—';
      paginationRange.textContent = '—';
      showState(error.message || 'Không thể tải danh sách sân. Vui lòng thử lại.', true, true);
      paginationButtons.replaceChildren();
    }
  }

  function setSport(value) {
    sportInput.value = allowedSports.has(value) ? value : '';
    updateSelectedSport();
    load(1);
  }

  const params = new URLSearchParams(window.location.search);
  const initialSport = (params.get('sport') || '').toUpperCase();
  sportInput.value = allowedSports.has(initialSport) ? initialSport : '';
  queryInput.value = params.get('q') || '';
  districtInput.value = params.get('district') || '';
  updateSelectedSport();

  document.querySelectorAll('.sport-tab-btn').forEach((button) => {
    button.addEventListener('click', () => setSport(button.dataset.sport));
  });
  document.querySelectorAll('.filter-sport-check').forEach((checkbox) => {
    checkbox.addEventListener('change', () => setSport(checkbox.checked ? checkbox.value : ''));
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    load(1);
  });
  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    sportInput.value = '';
    queryInput.value = '';
    districtInput.value = '';
    updateSelectedSport();
    load(1);
  });

  const requestedPage = Number(params.get('page'));
  load(Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
})();
