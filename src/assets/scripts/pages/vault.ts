import ApexCharts from 'apexcharts';
import Utils from '../utils/utils';
import $ from '../libs/jquery';
import { StateInterface } from 'community-js/lib/faces';
import Toast from '../utils/toast';
import app from '../app';
import Author from '../models/author';
import BalancesWorker from '../workers/balances';
import VaultWorker from '../workers/vault';
import Pager from '../utils/pager';

export default class PageVault {
  private chart: ApexCharts;
  let key: string = 'def16a344af117bb062472c41ae790e431a16402';
 
  async open() {
    $('.link-vault').addClass('active');
    $('.page-vault').show();
    this.syncPageState();

    this.events();
  }

  async close() {
    await this.removeEvents();

    $('.link-vault').removeClass('active');
    $('.page-vault').hide();
  }

  public async syncPageState() {
    const state = await app.getCommunity().getState();

    $('.ticker').text(state.ticker);

    const bal = await BalancesWorker.getAddressBalance(
      await app.getAccount().getAddress(),
      state.balances,
      state.vault,
    );
    $('.user-unlocked-balance').text(Utils.formatNumber(bal.unlocked));

    $('.min-lock-length').text(state.settings.get('lockMinLength'));
    $('.max-lock-length').text(state.settings.get('lockMaxLength'));

    let pa = null;
    const usersAndBalances = await VaultWorker.totalVaults(state.vault, app.getCurrentBlock());
    const pager = new Pager(Object.keys(usersAndBalances), $('.card').find('.card-footer'), 10);
    pager.onUpdate((p) => {
      pa = this.createOrUpdateTable(state, p.items);
    });
    pager.setPage(1);
    const myVault = state.vault[await app.getAccount().getAddress()];

    if ((await app.getAccount().isLoggedIn()) && myVault && myVault.length) {
      this.createOrUpdateMyTable(state);

      const { me, others } = await VaultWorker.meVsOthersWeight(state.vault, await app.getAccount().getAddress());
      this.createOrUpdateCharts(me, others);
    } else {
      $('.table-vault').find('tbody').html('');
      $('#chart-vault').addClass('text-center').text("Account doesn't have any locked balances.");

      const html = `
      <tr>
        <td class="text-muted text-center" data-label="Balance" colspan="4">
          Account doesn't have any locked balances.
        </td>
      </tr>
      `;
      $('.table-my-vault').find('tbody').html(html).parents('.dimmer').removeClass('active');

      await pa;
      $('.dimmer').removeClass('active');
    }
  }

  private async createOrUpdateMyTable(state: StateInterface): Promise<void> {
    let html = '';

    const vault = state.vault[await app.getAccount().getAddress()];

    for (let i = 0, j = vault.length; i < j; i++) {
      const v = vault[i];

      const voteWeight = v.balance * (v.end - v.start);
      let endsIn = v.end - app.getCurrentBlock();
      if (endsIn < 0) {
        endsIn = 0;
      }

      html += `<tr data-vault='${JSON.stringify(v)}'>
        <td class="text-muted" data-label="Balance">${Utils.formatNumber(v.balance)}</td>
        <td class="text-muted" data-label="Vote weight">${Utils.formatNumber(voteWeight)}</td>
        <td class="text-muted" data-label="Ends on">${Utils.formatNumber(endsIn)} blocks (${Utils.formatBlocks(
        endsIn,
      )})</td>
        <td class="text-right">
          <button class="btn btn-light align-text-top btn-increase-lock">Increase</button>
        </td>
      </tr>`;
    }

    $('.table-my-vault').find('tbody').html(html).parents('.dimmer').removeClass('active');
  }

  private async createOrUpdateTable(state: StateInterface, user): Promise<void> {
    let html = '';

    const usersAndBalances = await VaultWorker.totalVaults(state.vault, app.getCurrentBlock());

    for (let i = 0, j = user.length; i < j; i++) {
      let currentUser = user[i];
      const v = usersAndBalances[user[i]];
      if (!v.weight) {
        continue;
      }

      const acc = new Author(null, user[i], null);
      const arId = await acc.getDetails();
      const avatar = arId.avatar;

      html += `
      <tr>
        <td data-label="Token Holder">
          <div class="d-flex lh-sm py-1 align-items-center">
            <span class="avatar mr-2" style="background-image: url(${avatar})"></span>
            <div class="flex-fill">
              <div class="strong">${arId.name || user[i]}</div>
              <a href="./member.html#${user[i]}" target="_blank" class="text-muted text-h5">${user[i]}</a>
            </div>
          </div>
        </td>
        <td class="text-muted" data-label="Balance">${Utils.formatNumber(v.balance)}</td>
        <td class="text-muted" data-label="Vote weight">${Utils.formatNumber(v.weight)}</td>
      </tr>`;
    }

    $('.table-vault').find('tbody').html(html).parents('.dimmer').removeClass('active');
  }

  private async createOrUpdateCharts(me: number, others: number) {
    if (!this.chart) {
      this.chart = new ApexCharts(document.getElementById('chart-vault'), {
        chart: {
          type: 'donut',
          fontFamily: 'inherit',
          height: 175,
          sparkline: {
            enabled: true,
          },
          animations: {
            enabled: true,
          },
        },
        fill: { opacity: 1 },
        title: {
          text: 'Vote weight VS others',
        },
        labels: [],
        series: [],
        noData: {
          text: 'Loading...',
        },
        grid: {
          strokeDashArray: 4,
        },
        colors: ['#206bc4', '#79a6dc', '#bfe399', '#e9ecf1'],
        legend: { show: true },
        tooltip: { fillSeriesColor: false },
        yaxis: {
          labels: {
            formatter: (val) => `${val}%`,
          },
        },
      });
      this.chart.render();
    }

    const labels: string[] = ['Me', 'Others'];

    const total = me + others;
    let series = [0, 0];
    if (total > 0) {
      series = [Math.round((me / total) * 100), Math.round((others / total) * 100)];
    }

    this.chart.updateSeries(series);
    this.chart.updateOptions({
      labels,
    });

    $('#chart-vault').removeClass('text-center').parents('.dimmer').removeClass('active');
  }

  private events() {
    $('.btn-max-balance').on('click', async (e: any) => {
      e.preventDefault();

      const state = await app.getCommunity().getState();
      const bal = await BalancesWorker.getAddressBalance(
        await app.getAccount().getAddress(),
        state.balances,
        state.vault,
      );

      $('.input-max-balance').val(bal.unlocked);
    });

    $('.btn-max-lock').on('click', async (e: any) => {
      e.preventDefault();

      const state = await app.getCommunity().getState();
      $('.input-max-lock').val(state.settings.get('lockMaxLength'));
    });

    $('.do-lock-tokens').on('click', async (e: any) => {
      e.preventDefault();

      if (!(await app.getAccount().isLoggedIn())) {
        // @ts-ignore
        $('#modal-lock').modal('hide');
        return app.getAccount().showLoginError();
      }

      const balance = +$('#lock-balance').val().toString().trim();
      const length = +$('#lock-length').val().toString().trim();

      if (balance < 0 || length < 1) {
        return;
      }

      const state = await app.getCommunity().getState();
      const bal = await BalancesWorker.getAddressBalance(
        await app.getAccount().getAddress(),
        state.balances,
        state.vault,
      );
      if (balance > bal.unlocked) {
        return;
      }
      if (length < state.settings.get('lockMinLength') || length > state.settings.get('lockMaxLength')) {
        return;
      }

      $(e.target).addClass('btn-loading disabled');

      try {
        const txid = await app.getCommunity().lockBalance(balance, length);
        app
          .getStatusify()
          .add('Lock balance', txid)
          .then(() => {
            app.getCurrentPage().syncPageState();
          });
      } catch (err) {
        console.log(err.message);
        const toast = new Toast();
        toast.show('Lock balance error', err.message, 'error', 3000);
      }

      // @ts-ignore
      $('#modal-lock').modal('hide');
      $(e.target).removeClass('btn-loading disabled');
    });

    $('.btn-unlock-vault').on('click', async (e: any) => {
      e.preventDefault();

      if (!(await app.getAccount().isLoggedIn())) {
        return app.getAccount().showLoginError();
      }

      const prevHtml = $(e.target).html();
      $(e.target).addClass('disabled').html('<div class="spinner-border spinner-border-sm" role="status"></div>');

      try {
        const txid = await app.getCommunity().unlockVault();
        app
          .getStatusify()
          .add('Unlock vault', txid)
          .then(() => {
            app.getCurrentPage().syncPageState();
          });
      } catch (err) {
        console.log(err.message);
        const toast = new Toast();
        toast.show('Transfer error', err.message, 'error', 3000);
      }

      $(e.target).removeClass('disabled').html(prevHtml);
    });

    $(document).on('click', '.btn-increase-lock', async (e: any) => {
      e.preventDefault();

      const $tr = $(e.target).parents('tr');
      $('.vault-id').text(`#${$tr.index()}`).val($tr.index());

      // @ts-ignore
      $('#modal-increase-lock').modal('show');
    });

    $('.do-increase-lock').on('click', async (e: any) => {
      e.preventDefault();

      if (!(await app.getAccount().isLoggedIn())) {
        // @ts-ignore
        $('#modal-increase-lock').modal('hide');
        return app.getAccount().showLoginError();
      }

      const state = await app.getCommunity().getState();
      const length = +$('#increase-lock-length').val().toString().trim();
      if (length < state.settings.get('lockMinLength') || length > state.settings.get('lockMaxLength')) {
        return;
      }

      const vaultId = +$('#lock-vault-id').val().toString().trim();
      if (!state.vault[await app.getAccount().getAddress()][vaultId]) {
        // @ts-ignore
        $('#modal-increase-lock').modal('hide');
        const toast = new Toast();
        toast.show('Increase lock error', "This vault ID isn't available.", 'error', 3000);
        return;
      }

      $(e.target).addClass('disabled').html('<div class="spinner-border spinner-border-sm" role="status"></div>');
      try {
        const txid = await app.getCommunity().increaseVault(vaultId, length);
        app
          .getStatusify()
          .add('Increase lock', txid)
          .then(() => {
            app.getCurrentPage().syncPageState();
          });
      } catch (err) {
        console.log(err.message);
        const toast = new Toast();
        toast.show('Transfer error', err.message, 'error', 3000);
      }

      // @ts-ignore
      $('#modal-increase-lock').modal('hide');
      $(e.target).removeClass('disabled').text('Increase lock');
    });
  }

  private async removeEvents() {
    $('.btn-max-balance, .btn-max-lock, .do-lock-tokens, .btn-unlock-vault, .do-increase-lock').off('click');
    $(document).off('click', '.btn-increase-lock');
  }
}
