'use strict';

(() => {
  const grid = document.getElementById('featuredCourtsGrid');
  if (!grid) return;

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

  function showState(message, isError = false, retry = false) {
    const statsSection = document.getElementById('statisticsSection');
    if (statsSection) statsSection.hidden = true;
    grid.replaceChildren();
    const state = makeElement(
      'div',
      `col-span-full rounded-2xl bg-surface-container-lowest p-8 text-center ${isError ? 'text-error' : 'text-on-surface-variant'}`
    );
    state.setAttribute('role', isError ? 'alert' : 'status');
    state.textContent = message;
    if (retry) {
      const button = makeElement(
        'button',
        'mt-4 rounded-xl bg-primary px-4 py-2 font-bold text-white cursor-pointer',
        'Thử lại'
      );
      button.type = 'button';
      button.addEventListener('click', load);
      state.append(button);
    }
    grid.append(state);
  }

  function getFacilitySportList(facility) {
    return Array.isArray(facility.sports) ? facility.sports : [];
  }

  function updateStats(facilities, total) {
    const statsSection = document.getElementById('statisticsSection');
    if (statsSection) statsSection.hidden = false;
    document.querySelectorAll('[data-stat-total]').forEach((totalStat) => {
      totalStat.textContent = `${total} Cụm Sân`;
    });

    document.querySelectorAll('[data-stat-sport]').forEach((stat) => {
      const code = stat.dataset.statSport;
      const count = facilities.filter((facility) => getFacilitySportList(facility).includes(code)).length;
      stat.textContent = `${count} cơ sở`;
    });

    document.querySelectorAll('[data-sport-count]').forEach((countNode) => {
      const code = countNode.dataset.sportCount;
      const count = facilities.filter((facility) => getFacilitySportList(facility).includes(code)).length;
      countNode.textContent = `${count} cơ sở`;
    });

    const districtCount = new Set(facilities.map((facility) => facility.district).filter(Boolean)).size;
    const districtStat = document.querySelector('[data-district-count]');
    if (districtStat) districtStat.textContent = String(districtCount);
  }

  function createFacilityCard(facility) {
    const card = makeElement(
      'article',
      'bg-surface-container-lowest rounded-2xl shadow-sm hover:shadow-md transition-all p-4 flex flex-col gap-3 border border-gray-100'
    );
    const imageWrap = makeElement('div', 'relative h-44 overflow-hidden rounded-xl bg-surface-container flex items-center justify-center');
    const imageUrl = safeUrl(facility.image_url || '');
    if (imageUrl) {
      const image = makeElement('img', 'h-full w-full object-cover');
      image.src = imageUrl;
      image.alt = facility.name || '';
      imageWrap.append(image);
    } else {
      imageWrap.append(makeElement('span', 'material-symbols-outlined text-4xl text-primary', 'stadium'));
    }
    card.append(imageWrap);

    const title = makeElement('h3', 'text-base font-bold text-on-surface truncate', facility.name || '');
    card.append(title);

    const sport = makeElement('p', 'text-xs font-semibold text-primary', facility.sport_name || '');
    card.append(sport);

    const address = [facility.district, facility.address].filter(Boolean).join(' · ');
    card.append(makeElement('p', 'text-sm text-on-surface-variant line-clamp-2', address));

    const details = makeElement('div', 'flex items-center justify-between gap-2 text-sm');
    if (facility.rating !== null && facility.rating !== undefined) {
      details.append(makeElement('span', 'font-semibold text-amber-600', `★ ${facility.rating}`));
    }
    if (facility.price_min !== null && facility.price_min !== undefined) {
      details.append(makeElement(
        'span',
        'font-bold text-primary',
        `Từ ${Number(facility.price_min).toLocaleString('vi-VN')} đ`
      ));
    }
    card.append(details);

    const link = makeElement(
      'a',
      'mt-auto inline-flex items-center justify-center gap-1 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white shadow-sm',
      'Xem sân'
    );
    link.href = '#';
    card.append(link);
    return card;
  }

  async function load() {
    showState('Đang tải danh sách sân nổi bật...');
    try {
      let page = 1;
      let data;
      const facilities = [];
      do {
        data = await window.SportBookingFacilities.list({ page, page_size: 50 });
        if (!data) return;
        facilities.push(...data.facilities);
        page += 1;
      } while (page <= data.pagination.total_pages);

      updateStats(facilities, data.pagination.total);
      if (facilities.length === 0) {
        showState('Chưa có cơ sở sân phù hợp. Hãy mở Tìm sân để thử bộ lọc khác.');
        return;
      }

      const featured = [...facilities]
        .sort((left, right) => (Number(right.rating) || 0) - (Number(left.rating) || 0)
          || String(left.name || '').localeCompare(String(right.name || ''), 'vi'))
        .slice(0, 4);
      grid.replaceChildren(...featured.map(createFacilityCard));
    } catch (error) {
      showState(error.message || 'Không thể tải danh sách sân. Vui lòng thử lại.', true, true);
    }
  }

  document.querySelectorAll('[data-home-sport]').forEach((card) => {
    const navigate = () => {
      const params = new URLSearchParams({ sport: card.dataset.homeSport });
      window.location.assign(`/tim-san.html?${params}`);
    };
    card.setAttribute('role', 'link');
    card.tabIndex = 0;
    card.addEventListener('click', navigate);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navigate();
      }
    });
  });

  load();
})();
