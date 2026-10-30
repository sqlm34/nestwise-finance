import React from 'react';
import {Text,TextInput} from 'react-native';
import {styles} from './ui';
export type Credentials={email:string;password:string};
export type LoginFieldsProps=Credentials&{
  emailLabel:string;passwordLabel:string;editable:boolean;passwordReset:number;
  onChange:(value:Credentials)=>void;onSubmit:(value:Credentials)=>void;
};
export function StandardLoginFields(props:LoginFieldsProps) {
  return <>
    <Text style={styles.text}>{props.emailLabel}</Text>
    <TextInput accessibilityLabel={props.emailLabel} style={styles.input} value={props.email} onChangeText={email=>props.onChange({email,password:props.password})} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" editable={props.editable}/>
    <Text style={styles.text}>{props.passwordLabel}</Text>
    <TextInput accessibilityLabel={props.passwordLabel} style={styles.input} value={props.password} onChangeText={password=>props.onChange({email:props.email,password})} secureTextEntry autoComplete="current-password" editable={props.editable} onSubmitEditing={()=>props.onSubmit({email:props.email,password:props.password})}/>
  </>;
}
export const LoginFields=StandardLoginFields;
