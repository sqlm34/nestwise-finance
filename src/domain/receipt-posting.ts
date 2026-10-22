import {parseManualOperation,type Allocation} from './manual-operation';
import {parseReceipt,type ReceiptData} from './receipt';
import categoryData from '../data/accountant-categories.json';

export const receiptCategories=categoryData.categories.filter(c=>c.id!=='tax_00');
export function parseReceiptAllocations(value:unknown):Allocation[]{
  if(!Array.isArray(value)||value.length<1||value.length>43)throw new Error('invalid_receipt');
  let total=0n;
  for(const row of value){
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==2
      ||!receiptCategories.some(c=>c.id===row.category)||typeof row.cents!=='string'||!/^[1-9]\d{0,15}$/.test(row.cents))throw new Error('invalid_receipt');
    total+=BigInt(row.cents);
  }
  return parseManualOperation({id:'00000000-0000-4000-8000-000000000001',kind:'expense',paid_on:'2000-01-01',
    amount_cents:total.toString(),note:'',destination_account:null,reference_operation:null,allocations:value}).allocations;
}
export function prepareReceiptPosting(data:ReceiptData,review:string,operation:string,paid:string,allocations?:unknown){
  const receipt=parseReceipt(data,true);
  const split=allocations===undefined?undefined:parseReceiptAllocations(allocations);
  parseManualOperation({id:operation,kind:'expense',paid_on:paid,amount_cents:receipt.total_cents,note:receipt.supplier,
    destination_account:null,reference_operation:null,allocations:split??[{category:'other_expense',cents:receipt.total_cents}]});
  return {review,operation,paid_on:paid,...(split?{allocations:split}:{})};
}
