import React from 'react';
import {useWindowDimensions,type ViewProps} from 'react-native';
import {requireNativeView,requireOptionalNativeModule} from 'expo';
import {StandardLoginFields,type Credentials,type LoginFieldsProps} from './LoginFields.shared';

type NativeProps=ViewProps&{
  emailLabel:string;passwordLabel:string;initialEmail:string;editable:boolean;passwordReset:number;
  onCredentialsChange:(event:{nativeEvent:Credentials})=>void;
  onSubmitCredentials:(event:{nativeEvent:Credentials})=>void;
};
const NativeFields=requireOptionalNativeModule('NestwiseLogin')?requireNativeView<NativeProps>('NestwiseLogin'):null;

export function LoginFields(props:LoginFieldsProps) {
  const {fontScale}=useWindowDimensions();
  if(!NativeFields)return <StandardLoginFields {...props}/>;
  return <NativeFields style={{height:190*Math.max(1,fontScale)}} initialEmail={props.email}
    emailLabel={props.emailLabel} passwordLabel={props.passwordLabel} editable={props.editable} passwordReset={props.passwordReset}
    onCredentialsChange={({nativeEvent})=>props.onChange(nativeEvent)} onSubmitCredentials={({nativeEvent})=>props.onSubmit(nativeEvent)}/>;
}

