if (!window.hasAdsHighlighterListener) {
  window.hasAdsHighlighterListener = true;

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action !== 'highlight') return false;

    try {
      const items = [];
      const pageUrl = new URL(window.location.href);
      const isLocationPage = pageUrl.pathname.includes('matchedlocations');
      const customerId = pageUrl.searchParams.get('ocid') || pageUrl.searchParams.get('customerId') || null;
      const pageCampaignId = pageUrl.searchParams.get('campaignId');
      const pageCampaignName = document.querySelector('.campaign-name.entity-name')?.textContent?.trim()
        || document.querySelector('[class*="campaign-name"]')?.textContent?.trim()
        || null;

      const parseAdValue = (text) => {
        if (!text) return NaN;
        const cleaned = text.replace(/,/g, '').replace(/[^0-9.-]+/g, '');
        return Number.parseFloat(cleaned);
      };

      const simulateClick = (element) => {
        const options = { view: window, bubbles: true, cancelable: true, buttons: 1 };
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
          const EventClass = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
          element.dispatchEvent(new EventClass(type, options));
        });
      };

      const campaignIdFromLink = (link) => {
        if (!link?.href) return null;
        try {
          const url = new URL(link.href, window.location.origin);
          return url.searchParams.get('campaignId') || url.searchParams.get('campaignid');
        } catch { return null; }
      };

      document.querySelectorAll('.particle-table-row ess-cell').forEach((cell) => { cell.style.backgroundColor = ''; });
      const rows = document.querySelectorAll('.particle-table-row');

      rows.forEach((row, rowIndex) => {
        const checkbox = row.querySelector('mat-checkbox, material-checkbox');
        if (!checkbox) return;
        const costCell = row.querySelector('ess-cell[essfield="stats.cost"]');
        const convCell = row.querySelector('ess-cell[essfield="stats.conversion_value_per_cost"]');
        const allConvCell = row.querySelector('ess-cell[essfield="stats.all_conversion_value_per_cost"]');
        const costText = costCell?.innerText.trim() || '';
        const convText = convCell?.innerText.trim() || '';
        const allConvText = allConvCell?.innerText.trim() || '';
        const cost = parseAdValue(costText);
        const conv = parseAdValue(convText);
        const allConv = parseAdValue(allConvText);
        const isCostHigh = Number.isFinite(cost) && cost >= request.costThreshold;
        const isConvLow = Number.isFinite(conv) && conv <= request.convValueThreshold;
        const isAllConvLow = Number.isFinite(allConv) && allConv <= request.convValueThreshold;
        if (!isCostHigh || (!isConvLow && !isAllConvLow)) return;

        if (costCell) costCell.style.backgroundColor = '#ffcccc';
        if (isConvLow && convCell) convCell.style.backgroundColor = '#ffcccc';
        if (isAllConvLow && allConvCell) allConvCell.style.backgroundColor = '#ffcccc';

        const checked = checkbox.getAttribute('aria-checked') === 'true'
          || checkbox.querySelector('input[type="checkbox"]')?.checked;
        if (request.doTick && !checked) {
          simulateClick(checkbox.querySelector('.mat-checkbox-container, [class*="checkbox-container"]') || checkbox);
        }

        const campaignLink = row.querySelector('campaign-name[navi-id="campaign-table-campaign-name-cell"] a, campaign-name a, a[href*="campaignId"]');
        const campaignName = isLocationPage ? pageCampaignName : campaignLink?.textContent?.trim();
        const campaignId = isLocationPage ? pageCampaignId : campaignIdFromLink(campaignLink);
        const locationCell = row.querySelector('ess-cell[essfield="country_localized_full_name"] .location-cell, ess-cell[essfield="country_localized_full_name"]');
        const locationName = locationCell?.textContent?.trim() || null;
        const entityType = isLocationPage || locationName ? 'location' : 'campaign';
        const fallbackName = entityType === 'location' ? locationName : campaignName;
        if (!fallbackName) return;
        const locationId = entityType === 'location'
          ? row.getAttribute('data-entity-id') || locationCell?.getAttribute('data-entity-id') || locationName.toLowerCase().replace(/\s+/g, '-')
          : null;

        items.push({
          entityType,
          displayName: fallbackName,
          campaignId: campaignId || `campaign-${campaignName || pageCampaignName || 'unknown'}`,
          campaignName: campaignName || pageCampaignName || 'Unknown',
          locationId,
          locationName: entityType === 'location' ? locationName : null,
          rowIndex,
          metrics: { cost, conv, allConv, costText, convText, allConvText }
        });
      });

      sendResponse({
        status: 'success',
        items,
        context: { pageType: isLocationPage ? 'location' : 'campaign', customerId, campaignId: pageCampaignId, campaignName: pageCampaignName }
      });
    } catch (error) {
      sendResponse({ status: 'error', message: error.message, items: [] });
    }
    return true;
  });
}
