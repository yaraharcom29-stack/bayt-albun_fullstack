(() => {
  'use strict';

  const statusLabels = {
    pending: 'جديد',
    preparing: 'جارٍ التحضير',
    ready: 'جاهز',
    completed: 'مكتمل',
    cancelled: 'ملغي'
  };

  const adminStatus = document.getElementById('adminStatus');
  const ordersList = document.getElementById('ordersList');
  const messagesBody = document.getElementById('messagesBody');
  const subscribersBody = document.getElementById('subscribersBody');
  const refreshButton = document.getElementById('refreshButton');
  const numberFormat = new Intl.NumberFormat('ar-SA');
  const dateFormat = new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' });

  document.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-tab]').forEach(item => item.classList.toggle('active', item === button));
      document.querySelectorAll('.panel').forEach(panel => {
        const active = panel.id === `panel-${button.dataset.tab}`;
        panel.hidden = !active;
        panel.classList.toggle('active', active);
      });
    });
  });

  refreshButton.addEventListener('click', loadAll);
  ordersList.addEventListener('change', async event => {
    const select = event.target.closest('[data-order-status]');
    if (!select) return;
    const id = select.dataset.orderStatus;
    const previous = select.dataset.current;
    select.disabled = true;
    adminStatus.textContent = 'جارٍ تحديث حالة الطلب...';
    try {
      await api(`/api/admin/orders/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: select.value })
      });
      adminStatus.textContent = 'تم تحديث حالة الطلب ✓';
      await loadAll();
    } catch (error) {
      select.value = previous;
      adminStatus.textContent = error.message;
    } finally {
      select.disabled = false;
    }
  });

  async function loadAll() {
    refreshButton.disabled = true;
    adminStatus.textContent = 'جارٍ تحميل البيانات...';
    try {
      const [summary, ordersData, messagesData, subscribersData] = await Promise.all([
        api('/api/admin/summary'),
        api('/api/admin/orders?limit=150'),
        api('/api/admin/messages?limit=150'),
        api('/api/admin/subscribers?limit=150')
      ]);
      renderSummary(summary);
      renderOrders(ordersData.orders);
      renderMessages(messagesData.messages);
      renderSubscribers(subscribersData.subscribers);
      adminStatus.textContent = '';
    } catch (error) {
      console.error(error);
      adminStatus.textContent = error.message || 'تعذر تحميل لوحة الإدارة.';
    } finally {
      refreshButton.disabled = false;
    }
  }

  function renderSummary(summary) {
    document.getElementById('pendingOrders').textContent = numberFormat.format(summary.pendingOrders);
    document.getElementById('totalOrders').textContent = numberFormat.format(summary.totalOrders);
    document.getElementById('messagesCount').textContent = numberFormat.format(summary.messages);
    document.getElementById('subscribersCount').textContent = numberFormat.format(summary.subscribers);
  }

  function renderOrders(orders) {
    ordersList.replaceChildren();
    if (!orders.length) return ordersList.append(emptyState('لا توجد طلبات حتى الآن.'));

    orders.forEach(order => {
      const card = document.createElement('article');
      card.className = 'order-card';

      const top = document.createElement('div');
      top.className = 'order-top';
      const topInfo = document.createElement('div');
      const number = document.createElement('div');
      number.className = 'order-number';
      number.textContent = order.order_number;
      const meta = document.createElement('div');
      meta.className = 'order-meta';
      meta.textContent = `${formatDate(order.created_at)} • ${order.fulfillment_type === 'delivery' ? 'توصيل' : 'استلام من الفرع'}`;
      const badge = document.createElement('span');
      badge.className = `status-badge status-${order.status}`;
      badge.textContent = statusLabels[order.status] || order.status;
      topInfo.append(number, meta, badge);
      const total = document.createElement('div');
      total.className = 'order-total';
      total.textContent = `${numberFormat.format(order.total)} ر.س`;
      top.append(topInfo, total);

      const body = document.createElement('div');
      body.className = 'order-body';
      const details = document.createElement('div');
      details.className = 'order-details';
      details.append(
        detailLine('العميل', order.customer_name),
        detailLine('الموبايل', order.phone),
        detailLine('الإيميل', order.email || '—'),
        detailLine('العنوان', order.address || 'استلام من الفرع'),
        detailLine('ملاحظات', order.notes || '—')
      );

      const items = document.createElement('ul');
      items.className = 'order-items';
      order.items.forEach(item => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = `${item.product_name} × ${numberFormat.format(item.quantity)}`;
        const price = document.createElement('strong');
        price.textContent = `${numberFormat.format(item.line_total)} ر.س`;
        li.append(name, price);
        items.appendChild(li);
      });
      body.append(details, items);

      const actions = document.createElement('div');
      actions.className = 'order-actions';
      const label = document.createElement('label');
      label.textContent = 'حالة الطلب';
      const select = document.createElement('select');
      select.dataset.orderStatus = order.id;
      select.dataset.current = order.status;
      Object.entries(statusLabels).forEach(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        option.selected = value === order.status;
        select.appendChild(option);
      });
      actions.append(label, select);
      card.append(top, body, actions);
      ordersList.appendChild(card);
    });
  }

  function renderMessages(messages) {
    messagesBody.replaceChildren();
    if (!messages.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'empty';
      cell.textContent = 'لا توجد رسائل حتى الآن.';
      row.appendChild(cell);
      messagesBody.appendChild(row);
      return;
    }
    messages.forEach(message => {
      const row = document.createElement('tr');
      [formatDate(message.created_at), message.name, message.email, message.subject, message.message].forEach(value => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      });
      messagesBody.appendChild(row);
    });
  }

  function renderSubscribers(subscribers) {
    subscribersBody.replaceChildren();
    if (!subscribers.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 2;
      cell.className = 'empty';
      cell.textContent = 'لا يوجد مشتركون حتى الآن.';
      row.appendChild(cell);
      subscribersBody.appendChild(row);
      return;
    }
    subscribers.forEach(subscriber => {
      const row = document.createElement('tr');
      [formatDate(subscriber.created_at), subscriber.email].forEach(value => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      });
      subscribersBody.appendChild(row);
    });
  }

  function detailLine(labelText, valueText) {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${labelText}: `;
    const span = document.createElement('span');
    span.textContent = valueText;
    p.append(strong, span);
    return p;
  }

  function emptyState(text) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = text;
    return p;
  }

  function formatDate(sqliteDate) {
    if (!sqliteDate) return '—';
    const date = new Date(`${sqliteDate.replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime()) ? sqliteDate : dateFormat.format(date);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(data.error || `خطأ في الخادم (${response.status})`);
    return data;
  }

  loadAll();
})();
