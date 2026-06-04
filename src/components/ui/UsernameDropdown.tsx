import { useEffect, useState } from 'react';
import {
  FlatList, Modal, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { listUsers } from '../../firebase/firestoreService';
import { listCachedUsers } from '../../db/queries/credentialsCache';
import { UserRole } from '../../types';
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '../../constants/theme';

interface UserItem {
  username:  string;
  full_name: string;
}

interface Props {
  value:        string;
  onChange:     (username: string) => void;
  roles?:       UserRole[];
  disabled?:    boolean;
  placeholder?: string;
}

export default function UsernameDropdown({
  value, onChange, roles, disabled, placeholder = 'Type or select username',
}: Props) {
  const [open,  setOpen]  = useState(false);
  const [users, setUsers] = useState<UserItem[]>([]);

  useEffect(() => {
    listUsers()
      .then(all => {
        setUsers(
          all
            .filter(u => u.is_active && (!roles || roles.includes(u.role)))
            .map(({ username, full_name }) => ({ username, full_name })),
        );
      })
      .catch(() => {
        listCachedUsers()
          .then(all => {
            setUsers(
              all
                .filter(u => !roles || roles.includes(u.role as UserRole))
                .map(({ username, full_name }) => ({ username, full_name })),
            );
          })
          .catch(() => {});
      });
  }, []);

  function select(username: string) {
    onChange(username);
    setOpen(false);
  }

  return (
    <>
      <View style={[d.row, disabled && d.rowOff]}>
        <TextInput
          style={d.input}
          value={value}
          onChangeText={onChange}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={placeholder}
          placeholderTextColor={Colors.gray400}
          editable={!disabled}
        />
        {users.length > 0 && (
          <TouchableOpacity
            style={d.chevronBtn}
            onPress={() => !disabled && setOpen(true)}
            disabled={disabled}
            activeOpacity={0.7}
            hitSlop={8}
          >
            <Text style={d.chevron}>▾</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal
        transparent
        animationType="slide"
        visible={open}
        onRequestClose={() => setOpen(false)}
      >
        <View style={d.overlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setOpen(false)}
          />
          <View style={d.sheet}>
            <View style={d.sheetHandle} />
            <View style={d.sheetHeader}>
              <Text style={d.sheetTitle}>Select Username</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8}>
                <Text style={d.closeX}>✕</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={users}
              keyExtractor={item => item.username}
              style={d.list}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[d.item, item.username === value && d.itemSelected]}
                  onPress={() => select(item.username)}
                  activeOpacity={0.7}
                >
                  <Text style={[d.itemUsername, item.username === value && d.itemUsernameSelected]}>
                    {item.username}
                  </Text>
                  {!!item.full_name && (
                    <Text style={d.itemFullName}>{item.full_name}</Text>
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const d = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    backgroundColor: Colors.gray50,
  },
  rowOff: {
    opacity: 0.5,
  },
  input: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.gray800,
  },
  chevronBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderLeftWidth: 1,
    borderLeftColor: Colors.gray200,
  },
  chevron: {
    fontSize: FontSize.lg,
    color: Colors.gray500,
  },

  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: '60%',
    paddingBottom: Spacing.xl,
    ...Shadow.lg,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.gray200,
    alignSelf: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray100,
  },
  sheetTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.gray800,
  },
  closeX: {
    fontSize: FontSize.md,
    color: Colors.gray500,
    fontWeight: FontWeight.bold,
    padding: Spacing.xs,
  },
  list: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
  },
  item: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray100,
    borderRadius: Radius.sm,
  },
  itemSelected: {
    backgroundColor: Colors.green50,
  },
  itemUsername: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray800,
  },
  itemUsernameSelected: {
    color: Colors.green700,
  },
  itemFullName: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
    marginTop: 2,
  },
});
