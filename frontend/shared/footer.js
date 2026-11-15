'use strict';

(() => {
  const supportHotline = window.SportBookingConstants?.SUPPORT_HOTLINE;
  if (!supportHotline) throw new Error('Thiếu cấu hình hotline hỗ trợ SportBooking.');
  const supportHotlineHref = `tel:${supportHotline.replace(/\D/g, '')}`;
  const setSupportHotline = (root) => {
    for (const hotline of root.querySelectorAll('[data-support-hotline]')) {
      hotline.textContent = supportHotline;
      if (hotline.tagName === 'A') hotline.href = supportHotlineHref;
    }
  };
  setSupportHotline(document);

  const mount = document.querySelector('[data-shared-footer]');
  if (!mount) return;

  const footer = document.createElement('footer');
  footer.className = 'w-full bg-[#f1f3ff] border-t border-gray-200 shadow-[0_-1px_6px_rgba(0,0,0,0.02)]';
  footer.innerHTML = `
    <div class="max-w-[1440px] mx-auto px-margin py-8 flex flex-col md:flex-row items-center justify-between gap-6">
      <div class="flex flex-col gap-1 text-left">
        <div class="flex items-center gap-2">
          <span class="font-bold text-base text-primary">SportBooking Hà Nội</span>
          <span class="text-on-surface-variant text-xs">| Nền tảng đặt sân thể thao thông minh</span>
        </div>
        <p class="text-on-surface-variant text-xs">Hệ thống đặt sân thể thao SportBooking Hà Nội - Đặt sân trực tuyến nhanh chóng, tiện lợi &amp; chuẩn xác</p>
        <p class="text-on-surface text-sm">Hotline hỗ trợ 24/7: <a class="font-bold text-secondary" data-support-hotline href="${supportHotlineHref}"></a></p>
      </div>
      <div class="flex flex-col md:items-end gap-1.5">
        <div class="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
          <span class="hover:text-primary transition-colors" aria-disabled="true" title="Sắp có">Hỗ trợ khách hàng · Sắp có</span>
          <span>•</span>
          <span class="hover:text-primary transition-colors" aria-disabled="true" title="Sắp có">Điều khoản sử dụng · Sắp có</span>
          <span>•</span>
          <span class="hover:text-primary transition-colors" aria-disabled="true" title="Sắp có">Chính sách bảo mật · Sắp có</span>
        </div>
        <p class="text-xs text-on-surface-variant">© 2026 SportBooking Hà Nội. Tất cả các quyền được bảo lưu.</p>
      </div>
    </div>`;
  mount.replaceChildren(footer);
  setSupportHotline(footer);
})();
