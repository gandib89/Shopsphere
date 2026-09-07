import { createContext, useContext } from 'react';

type SellerApproval = { loaded: boolean; pending: boolean };
export const SellerApprovalContext = createContext<SellerApproval>({ loaded: false, pending: false });
export const useSellerApproval = () => useContext(SellerApprovalContext);
