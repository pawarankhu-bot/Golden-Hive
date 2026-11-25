/* ==========================================================
   Golden Hive — shared script (product / order / admin)
   Each page is detected by the elements it contains.
   ========================================================== */

(function () {
  'use strict';

  var ORDER_ENDPOINT =
    'https://script.google.com/macros/s/AKfycbyvpqEfXg_0rGZvl4r-yZTbTbOf9NWbm10QiII_VeInGQKjcCzZCBx2JxotZkWud0rK/exec';

  var ORDERS_CSV_URL =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vRyYhgQxLq-qgsB324Fb6Gt2rZzT4c04GT1V0xXGsUvL2JsPIPzx2BagBS7Ei6jyJzJU0x_HC2qM-kW/pub?gid=0&single=true&output=csv';

  document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('product-list')) initProductPage();
    if (document.getElementById('orderForm')) initOrderPage();
    if (document.querySelector('#ordersTable tbody')) initAdminPage();
  });

  /* ------------------------------------------------------
     1) product.html — product cards + mood filter
     ------------------------------------------------------ */

  // Compare moods ignoring case and spaces ("50 ml" == "50ml")
  function normalizeMood(value) {
    return String(value || '').replace(/\s+/g, '').toLowerCase();
  }

  function formatPrice(price) {
    return Number(price).toLocaleString('th-TH') + ' บาท';
  }

  function initProductPage() {
    var list = document.getElementById('product-list');
    var bar = document.getElementById('filter-bar');
    var products = [];
    var activeMood = 'all';

    fetch('products.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        products = data;
        buildFilterBar();

        // ?mood=xxx → filter automatically on load
        var param = new URLSearchParams(window.location.search).get('mood');
        if (param) {
          var match = products.find(function (p) {
            return normalizeMood(p.mood) === normalizeMood(param);
          });
          if (match) activeMood = match.mood;
        }

        setActiveButton();
        render();
      })
      .catch(function (error) {
        console.error(error);
        list.textContent = 'ไม่สามารถโหลดรายการสินค้าได้ กรุณาลองใหม่อีกครั้ง';
      });

    // Buttons are built from the moods found in products.json
    function buildFilterBar() {
      if (!bar) return;
      bar.innerHTML = '';

      var moods = [];
      products.forEach(function (p) {
        if (p.mood && moods.indexOf(p.mood) === -1) moods.push(p.mood);
      });

      addButton('all', 'ทั้งหมด');
      moods.forEach(function (m) { addButton(m, m); });
    }

    function addButton(value, label) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn filter-btn';
      btn.dataset.mood = value;
      btn.textContent = label;
      btn.addEventListener('click', function () {
        activeMood = value;
        setActiveButton();
        render();
      });
      bar.appendChild(btn);
    }

    function setActiveButton() {
      if (!bar) return;
      Array.prototype.forEach.call(bar.querySelectorAll('.filter-btn'), function (btn) {
        var isActive = btn.dataset.mood === activeMood;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

    function render() {
      list.innerHTML = '';

      var visible = products.filter(function (p) {
        return activeMood === 'all' || normalizeMood(p.mood) === normalizeMood(activeMood);
      });

      if (!visible.length) {
        list.textContent = 'ไม่พบสินค้าในหมวดนี้';
        return;
      }

      visible.forEach(function (p) {
        list.appendChild(createCard(p));
      });
    }

    function createCard(p) {
      var card = document.createElement('article');
      card.className = 'card';

      var img = document.createElement('img');
      img.className = 'card__image';
      img.src = encodeURI(p.image);
      img.alt = p.name;
      img.loading = 'lazy';

      var title = document.createElement('h3');
      title.className = 'card__title';
      title.textContent = p.name;

      var size = document.createElement('p');
      size.className = 'size';
      size.textContent = 'ขนาด ' + p.size;

      var footer = document.createElement('div');
      footer.className = 'card__footer';

      var price = document.createElement('span');
      price.className = 'price';
      price.textContent = formatPrice(p.price);

      var buy = document.createElement('a');
      buy.className = 'btn btn--gold';
      buy.textContent = 'สั่งซื้อ';
      buy.href =
        'order.html?item=' + encodeURIComponent(p.name) +
        '&price=' + encodeURIComponent(p.price);

      footer.appendChild(price);
      footer.appendChild(buy);

      card.appendChild(img);
      card.appendChild(title);
      card.appendChild(size);
      card.appendChild(footer);
      return card;
    }
  }

  /* ------------------------------------------------------
     2) order.html — autofill + submit
     ------------------------------------------------------ */

  function initOrderPage() {
    var form = document.getElementById('orderForm');
    var params = new URLSearchParams(window.location.search);

    // Fill both fields as soon as the page loads
    var itemField = document.getElementById('items');
    var totalField = document.getElementById('total');
    if (itemField && params.has('item')) itemField.value = params.get('item');
    if (totalField && params.has('price')) totalField.value = params.get('price');

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var payload = {
        customerName: document.getElementById('customerName').value,
        contact: document.getElementById('contact').value,
        items: document.getElementById('items').value,
        total: document.getElementById('total').value,
        note: document.getElementById('note').value
      };

      var submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      fetch(ORDER_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      .then(() => { window.location.href = 'thankyou.html'; })
      .catch(error => {
        console.error(error);
        alert('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
        if (submitBtn) submitBtn.disabled = false;
      });
    });
  }

  /* ------------------------------------------------------
     3) admin.html — orders table from published CSV
     ------------------------------------------------------ */

  // Minimal CSV parser: quoted fields, "" escapes, commas and
  // line breaks inside quotes, CRLF / LF / CR line endings.
  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }

    // last field / row without trailing newline
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }

    // drop completely empty rows
    return rows.filter(function (r) {
      return r.some(function (cell) { return cell.trim() !== ''; });
    });
  }

  function initAdminPage() {
    var tbody = document.querySelector('#ordersTable tbody');
    var COLUMNS = 6;

    showMessage('กำลังโหลดข้อมูล...');

    fetch(ORDERS_CSV_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var rows = parseCSV(text);
        rows.shift(); // header row

        if (!rows.length) {
          showMessage('ยังไม่มีรายการสั่งซื้อ');
          return;
        }

        // Newest first: sort by date if every date can be read,
        // otherwise reverse the sheet order (new orders are appended at the bottom)
        var dates = rows.map(function (r) { return Date.parse(r[0]); });
        var allValid = dates.every(function (d) { return !isNaN(d); });

        if (allValid) {
          rows = rows
            .map(function (r, i) { return { r: r, d: dates[i] }; })
            .sort(function (a, b) { return b.d - a.d; })
            .map(function (x) { return x.r; });
        } else {
          rows.reverse();
        }

        tbody.innerHTML = '';
        rows.forEach(function (r) {
          var tr = document.createElement('tr');
          for (var c = 0; c < COLUMNS; c++) {
            var td = document.createElement('td');
            td.textContent = r[c] !== undefined ? r[c] : '';
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        });
      })
      .catch(function (error) {
        console.error(error);
        showMessage('ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง');
      });

    function showMessage(msg) {
      tbody.innerHTML = '';
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = COLUMNS;
      td.textContent = msg;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }
})();
