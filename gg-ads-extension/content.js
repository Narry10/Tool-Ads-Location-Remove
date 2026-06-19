// Ensure we only add the listener once
if (!window.hasAdsHighlighterListener) {
  window.hasAdsHighlighterListener = true;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'highlight') {
      const costThreshold = request.costThreshold;
      const convValueThreshold = request.convValueThreshold;
      const doTick = request.doTick;
      const failedCountries = [];

      // Reset previous highlights
      document.querySelectorAll('.particle-table-row').forEach(row => {
        const cells = row.querySelectorAll('ess-cell');
        cells.forEach(cell => {
          cell.style.backgroundColor = '';
        });
      });

      const rows = document.querySelectorAll('.particle-table-row');

      // Helper to parse text like $4.13 or 1,234.56
      const parseAdValue = (text) => {
        if (!text) return NaN;
        // Remove comma (thousands separator) and any non-numeric/dot/minus characters
        const cleaned = text.replace(/,/g, '').replace(/[^0-9.-]+/g, "");
        return parseFloat(cleaned);
      };

      // Helper to simulate a real user click
      const simulateClick = (element) => {
        const eventOptions = {
          view: window,
          bubbles: true,
          cancelable: true,
          buttons: 1
        };
        
        // Fire a full sequence of events that modern web frameworks expect
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(eventType => {
          const ev = new MouseEvent(eventType, eventOptions);
          element.dispatchEvent(ev);
        });
      };

      rows.forEach(row => {
        // Find checkbox to skip headers/totals and allow ticking
        const checkbox = row.querySelector('mat-checkbox');
        if (!checkbox) return;

        // Extract values
        const costCell = row.querySelector('ess-cell[essfield="stats.cost"]');
        const costText = costCell ? costCell.innerText.trim() : "";
        const costVal = parseAdValue(costText);

        const convCell = row.querySelector('ess-cell[essfield="stats.conversion_value_per_cost"]');
        const convText = convCell ? convCell.innerText.trim() : "";
        const convVal = parseAdValue(convText);

        const allConvCell = row.querySelector('ess-cell[essfield="stats.all_conversion_value_per_cost"]');
        const allConvText = allConvCell ? allConvCell.innerText.trim() : "";
        const allConvVal = parseAdValue(allConvText);

        // Conditions (using >= and <= for inclusive comparison)
        const isCostHigh = !isNaN(costVal) && costVal >= costThreshold;
        const isConvLow = !isNaN(convVal) && convVal <= convValueThreshold;
        const isAllConvLow = !isNaN(allConvVal) && allConvVal <= convValueThreshold;

        // Condition: Cost >= threshold AND (Conv Value <= threshold OR All Conv Value <= threshold)
        if (isCostHigh && (isConvLow || isAllConvLow)) {
          
          // 1. Highlight cells
          if (costCell) costCell.style.backgroundColor = '#ffcccc'; // light red
          if (isConvLow && convCell) convCell.style.backgroundColor = '#ffcccc';
          if (isAllConvLow && allConvCell) allConvCell.style.backgroundColor = '#ffcccc';

          // 2. Tick the checkbox if requested and not already ticked
          if (doTick && checkbox.getAttribute('aria-checked') === 'false') {
            // Target the specific container or the checkbox itself
            const container = checkbox.querySelector('.mat-checkbox-container');
            if (container) {
              simulateClick(container);
            } else {
              simulateClick(checkbox);
            }
          }

          // 3. Extract Country Name
          const nameCell = row.querySelector('ess-cell[essfield="country_localized_full_name"] .location-cell');
          const countryName = nameCell ? nameCell.innerText.trim() : "Unknown";
          
          failedCountries.push({
            name: countryName,
            cost: costText || '-',
            conv: convText || '-',
            allConv: allConvText || '-'
          });
        }
      });

      sendResponse({ status: "success", failedCountries: failedCountries });
    }
    return true;
  });
}
