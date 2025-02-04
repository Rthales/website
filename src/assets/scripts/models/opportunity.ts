import OpportunityInterface, {
  OpportunityCommunityInterface,
  OpportunityType,
  OpportunityExpLevel,
  OpportunityCommitment,
  OpportunityProjectType,
  OpportunityPermission,
  OpportunityStatus,
} from '../interfaces/opportunity';
import Utils from '../utils/utils';
import { GQLTransactionsResultInterface, GQLEdgeInterface, GQLNodeInterface } from '../interfaces/gqlResult';
import Transaction from 'arweave/node/lib/transaction';
import Toast from '../utils/toast';
import OpportunitiesWorker from '../workers/opportunities';
import Applicant from './applicant';
import Author from './author';
import communityDB from '../libs/db';
import arweave from '../libs/arweave';
import JobBoard from '../opportunity/jobboard';

export default class Opportunity implements OpportunityInterface {
  id?: string;
  title: string;
  community: OpportunityCommunityInterface;
  description: string;
  payout: string;
  lockLength: number;
  type: OpportunityType;
  experience: OpportunityExpLevel;
  commitment: OpportunityCommitment;
  project: OpportunityProjectType;
  permission: OpportunityPermission;
  owner: string;
  author: Author;
  status: OpportunityStatus;
  updateTx: Transaction;
  timestamp: number;
  applicants: Applicant[];

  constructor(params: OpportunityInterface) {
    if (Object.keys(params).length) {
      params = Utils.stripTags(params);
      for (const key in params) {
        this[key] = params[key];
      }
    }

    this.status = 'Active';
    this.applicants = [];
  }

  async getDescription(): Promise<string> {
    if (!this.description) {
      const res = await arweave.api.get(`/${this.id}`);
      this.description = Utils.escapeScriptStyles(res.data);
    }

    return this.description;
  }

  async update(params?: { [key: string]: string }, caller?: typeof JobBoard) {
    if (params) {
      return this.doUpdate(params, caller);
    }

    const query = {
      query: `
      query{
        transactions(
          first: 1
          owners: "${this.author.address}"
          tags:[
          {
            name: "App-Name",
            values: "CommunityXYZ"
          },
          {
            name: "Action",
            values: "updateOpportunity"
          },
          {
            name: "Opportunity-ID",
            values: "${this.id}"
          }]
        ){
          pageInfo {
            hasNextPage
          }
          edges {
            cursor
            node {
              id
              owner {
                address
              },
              tags {
                name,
                value
              }
              block {
                timestamp
                height
              }
            }
          }
        }
      }
      `,
    };

    let txs: GQLTransactionsResultInterface;
    try {
      const res = await arweave.api.request().post('https://arweave.net/graphql', query);
      txs = res.data.data.transactions;
    } catch (err) {
      console.log(err);
      const toast = new Toast();
      toast.show('Error', 'Error connecting to the network.', 'error', 5000);
      return;
    }

    if (!txs.edges.length) {
      return;
    }

    for (let i = 0; i < txs.edges[0].node.tags.length; i++) {
      if (txs.edges[0].node.tags[i].name === 'status') {
        // @ts-ignore
        this.status = txs.edges[0].node.tags[i].value;
        break;
      }
    }
  }

  private async doUpdate(params: { [key: string]: string }, caller: typeof JobBoard) {
    $('.btn-opp-status').addClass('btn-loading');

    const keys = Object.keys(params);
    if (!keys.length) {
      return false;
    }

    const wallet = await caller.getAccount().getWallet();

    const toast = new Toast();
    if (this.author.address !== (await caller.getAccount().getAddress())) {
      toast.show('Error', 'You cannot edit this opportunity.', 'error', 5000);
      return false;
    }

    const fees = await caller.getChargeFee();
    if (!fees) {
      $('.btn-opp-status').removeClass('btn-loading');
      return false;
    }

    const tx = await arweave.createTransaction(
      {
        target: fees.target,
        quantity: fees.winstonQty,
        data: Math.random().toString().substr(-4),
      },
      wallet,
    );
    if (!fees.target || !fees.target.length) {
      await arweave.createTransaction(
        {
          data: Math.random().toString().substr(-4),
        },
        wallet,
      );
    }

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      tx.addTag(key, params[key]);
    }

    tx.addTag('App-Name', 'CommunityXYZ');
    tx.addTag('Action', 'updateOpportunity');
    tx.addTag('Opportunity-ID', this.id);
    tx.addTag('Service', 'Community.XYZ');
    tx.addTag('Community-ID', this.community.id);
    tx.addTag('Message', `Updated opportunity ID ${this.id}`);
    tx.addTag('Type', 'ArweaveActivity');

    await arweave.transactions.sign(tx, wallet);
    const res = await arweave.transactions.post(tx);
    if (res.status !== 200 && res.status !== 202) {
      console.log(res);

      toast.show('Error', 'Error submitting transaction.', 'error', 5000);
      $('.btn-opp-status').removeClass('btn-loading');
      return false;
    }

    caller.getStatusify().add('Update opportunity', tx.id);
    $('.btn-opp-status').removeClass('btn-loading');
  }

  static async getAll(oppIds?: string[]): Promise<Opportunity[]> {
    let hasNextPage = true;
    let edges: GQLEdgeInterface[] = [];
    let cursor = '';

    const oppTagStr = oppIds && oppIds.length ? `, {name: "communityId", values: ${JSON.stringify(oppIds)}}` : '';

    while (hasNextPage) {
      const query = {
        query: `
        query{
          transactions(
            first: 100
            tags:[
              {
                name: "App-Name",
                values: "CommunityXYZ"
              },
              {
                name: "Action",
                values: "addOpportunity"
              }
              ${oppTagStr}
            ]
            after: "${cursor}"
          ){
            pageInfo {
              hasNextPage
            }
            edges {
              cursor
              node {
                id
                owner {
                  address
                },
                tags {
                  name,
                  value
                }
                block {
                  timestamp
                  height
                }
              }
            }
          }
        }
        `,
      };

      let res: any;
      try {
        res = await arweave.api.request().post('https://arweave.net/graphql', query);
      } catch (err) {
        console.log(err);

        const toast = new Toast();
        toast.show('Error', 'Error connecting to the network.', 'error', 5000);
        return;
      }

      const transactions: GQLTransactionsResultInterface = res.data.data.transactions;
      if (transactions.edges && transactions.edges.length) {
        edges = edges.concat(transactions.edges);
        cursor = transactions.edges[transactions.edges.length - 1].cursor;
      }

      hasNextPage = transactions.pageInfo.hasNextPage;
    }

    let opps: Opportunity[] = [];

    let current = -1;
    const go = async (index = 0) => {
      if (index >= edges.length) {
        return true;
      }
      const res = await OpportunitiesWorker.nodeToOpportunity(edges[index].node);
      try {
        communityDB.set(res.id, res);
      } catch (err) {}

      const opp = new Opportunity(res);

      opp.author = new Author(edges[index].node.owner.address, edges[index].node.owner.address, null);
      opps.push(opp);

      return go(++current);
    };

    const gos = [];
    for (let i = 0, j = edges.length > 5 ? 5 : edges.length; i < j; i++) {
      gos.push(go(++current));
    }
    await Promise.all(gos);

    // Get updates
    opps = await this.updateAll(opps);

    // get all applicants
    const allApplicants = await Applicant.getAll(opps.map((opp) => opp.id));
    for (let i = 0, j = opps.length; i < j; i++) {
      for (let k = 0, l = allApplicants.length; k < l; k++) {
        if (opps[i].id === allApplicants[k].oppId) {
          opps[i].applicants.push(allApplicants[k]);
        }
      }
    }

    opps.sort((a, b) => b.timestamp - a.timestamp);
    return opps;
  }

  static async updateAll(opps: Opportunity[]) {
    let hasNextPage = true;
    let edges: GQLEdgeInterface[] = [];
    let cursor = '';

    const ids = JSON.stringify(opps.map((opp) => opp.id));
    while (hasNextPage) {
      const query = {
        query: `
        query{
          transactions(
            first: 100
            tags:[
              {
                name: "App-Name",
                values: "CommunityXYZ"
              },
              {
                name: "Action",
                values: "updateOpportunity"
              },
              {
                name: "Opportunity-ID",
                values: ${ids}
              }]
            after: "${cursor}"
          ){
            pageInfo {
              hasNextPage
            }
            edges {
              cursor
              node {
                id
                owner {
                  address
                },
                tags {
                  name,
                  value
                }
                block {
                  timestamp
                  height
                }
              }
            }
          }
        }
        `,
      };

      let res: any;
      try {
        res = await arweave.api.request().post('https://arweave.net/graphql', query);
      } catch (err) {
        console.log(err);

        const toast = new Toast();
        toast.show('Error', 'Error connecting to the network.', 'error', 5000);
        return;
      }

      const transactions: GQLTransactionsResultInterface = res.data.data.transactions;
      if (transactions.edges && transactions.edges.length) {
        edges = edges.concat(transactions.edges);
        cursor = transactions.edges[transactions.edges.length - 1].cursor;
      }

      hasNextPage = transactions.pageInfo.hasNextPage;
    }

    const updates: Map<string, GQLNodeInterface> = new Map();
    for (let i = 0, j = edges.length; i < j; i++) {
      for (let j = 0; j < edges[i].node.tags.length; j++) {
        const tag = edges[i].node.tags[j];

        if (tag.name === 'Opportunity-ID') {
          if (updates.has(tag.value)) {
            break;
          }
          updates.set(tag.value, edges[i].node);
          break;
        }
      }
    }

    const tmpOpps: Opportunity[] = [];
    for (let i = 0, j = opps.length; i < j; i++) {
      const opp = updates.get(opps[i].id);
      if (opp) {
        for (let k = 0; k < opp.tags.length; k++) {
          if (opp.tags[k].name === 'status') {
            // @ts-ignore
            opps[i].status = opp.tags[k].value;
            break;
          }
        }

        if (opps[i].status !== 'Closed' && opps[i].status !== 'Finished') {
          tmpOpps.push(opps[i]);
        }
      } else {
        tmpOpps.push(opps[i]);
      }
    }

    return tmpOpps;
  }

  static async getOpportunity(opportunityId: string): Promise<Opportunity> {
    let res: OpportunityInterface = communityDB.get(opportunityId);
    if (!res) {
      const query = {
        query: `
        query{
          transaction(
            id: "${opportunityId}"
          ){
            id
            owner {
              address
            },
            tags {
              name,
              value
            }
            block {
              timestamp
              height
            }
          }
        }
        `,
      };

      let tx: GQLNodeInterface;
      try {
        const res = await arweave.api.post('/graphql', query);
        tx = res.data.data.transaction;
      } catch (err) {
        console.log(err);

        const toast = new Toast();
        toast.show('Error', 'Error connecting to the network.', 'error', 5000);
        return;
      }

      if (!tx) {
        return;
      }

      res = await OpportunitiesWorker.nodeToOpportunity(tx);
      try {
        communityDB.set(opportunityId, res);
      } catch (err) {}
    }
    const opp = new Opportunity(res);
    opp.author = new Author(res.owner, res.owner, null);

    // get all applicants
    const allApplicants = await Applicant.getAll([opp.id]);
    for (let k = 0, l = allApplicants.length; k < l; k++) {
      if (opp.id === allApplicants[k].oppId) {
        opp.applicants.push(allApplicants[k]);
      }
    }

    return opp;
  }
}
