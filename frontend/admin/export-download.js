'use strict';

(function exposeExportDownload(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingExportDownload = api;
}(typeof window === 'undefined' ? null : window, () => {
  const XLSX_CONTENT_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function getFilename(contentDisposition) {
    if (typeof contentDisposition !== 'string') return null;
    return /filename="([a-z0-9-]+-\d{8}-\d{4}\.xlsx)"/i.exec(contentDisposition)?.[1] || null;
  }

  function getErrorMessage(status, code, message) {
    if (status === 401) return 'Phiên đăng nhập đã hết hạn. Đang chuyển tới đăng nhập.';
    if (status === 403) return 'Bạn không có quyền xuất báo cáo này.';
    if (status === 400 && code === 'EXPORT_TOO_MANY_ROWS') {
      return 'Quá nhiều dòng, hãy lọc thu hẹp';
    }
    if (status === 400 && typeof message === 'string' && message.trim()) return message;
    if (status === 0) return 'Không thể kết nối tới máy chủ. Vui lòng kiểm tra mạng và thử lại.';
    return 'Không thể xuất báo cáo Excel. Vui lòng thử lại.';
  }

  async function fetchFile(url) {
    let response;
    try {
      response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    } catch (cause) {
      const error = new Error(getErrorMessage(0));
      error.cause = cause;
      throw error;
    }
    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      const code = payload?.error?.code;
      const message = getErrorMessage(response.status, code, payload?.error?.message);
      if (response.status === 401 && typeof window !== 'undefined') {
        const destination = code === 'ACCOUNT_LOCKED'
          ? '/dang-nhap.html?locked=1'
          : '/dang-nhap.html';
        window.location.replace(destination);
      }
      const error = new Error(message);
      error.status = response.status;
      error.code = code;
      throw error;
    }
    const filename = getFilename(response.headers.get('content-disposition') || '');
    if (!filename) throw new Error('Tên tệp xuất từ máy chủ không hợp lệ.');
    const contentType = (response.headers.get('content-type') || '').split(';', 1)[0];
    if (contentType !== XLSX_CONTENT_TYPE) {
      throw new Error('Định dạng tệp xuất từ máy chủ không hợp lệ.');
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('Tệp Excel không có dữ liệu.');
    return { blob, filename };
  }

  function setButtonLoading(button, loading) {
    if (!button) throw new TypeError('Cần nút xuất báo cáo.');
    const label = button.querySelector('[data-export-label]');
    if (label) {
      if (loading) {
        if (!Object.hasOwn(button.dataset, 'exportIdleText')) {
          button.dataset.exportIdleText = label.textContent;
        }
        label.textContent = 'Đang xuất...';
      } else if (Object.hasOwn(button.dataset, 'exportIdleText')) {
        label.textContent = button.dataset.exportIdleText;
        delete button.dataset.exportIdleText;
      }
    }
    button.disabled = Boolean(loading);
    if (loading) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
  }

  async function download(button, status, request, {
    successMessage = 'Đã tải báo cáo Excel.',
    onSuccess,
    onError
  } = {}) {
    if (!button || !status || typeof request !== 'function') {
      throw new TypeError('Thiếu cấu hình tải báo cáo.');
    }
    if (button.disabled) return false;
    setButtonLoading(button, true);
    status.hidden = true;
    try {
      const { blob, filename } = await request();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (typeof onSuccess === 'function') onSuccess(successMessage);
      else {
        status.setAttribute('role', 'status');
        status.dataset.kind = 'success';
        status.textContent = successMessage;
        status.hidden = false;
      }
      return true;
    } catch (error) {
      const handled = typeof onError === 'function' && onError(error);
      if (!handled) {
        status.setAttribute('role', 'alert');
        status.dataset.kind = 'error';
        status.textContent = error.message || 'Không thể xuất báo cáo Excel. Vui lòng thử lại.';
        status.hidden = false;
      }
      return false;
    } finally {
      setButtonLoading(button, false);
    }
  }

  return { download, fetchFile, getErrorMessage, getFilename, setButtonLoading };
}));
